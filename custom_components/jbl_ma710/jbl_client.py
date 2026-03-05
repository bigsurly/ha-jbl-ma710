"""JBL MA Series IP Control Client — robust framed TCP implementation."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable

_LOGGER = logging.getLogger(__name__)

# Protocol constants
START_BYTE  = 0x23
RSP_START_0 = 0x02
RSP_START_1 = 0x23
END_BYTE    = 0x0D
RSP_OK      = 0x00

# Command IDs
CMD_POWER     = 0x00
CMD_INPUT     = 0x05
CMD_VOLUME    = 0x06
CMD_MUTE      = 0x07
CMD_SURROUND  = 0x08
CMD_TREBLE    = 0x0B
CMD_BASS      = 0x0C
CMD_STREAMING = 0x11
CMD_INIT      = 0x50
CMD_HEARTBEAT = 0x51

REQUEST = 0xF0  # Query/request current value

SOURCES: dict[str, int] = {
    "TV (ARC)":  0x01,
    "HDMI 1":    0x02,
    "HDMI 2":    0x03,
    "HDMI 3":    0x04,
    "HDMI 4":    0x05,
    "HDMI 5":    0x06,
    "HDMI 6":    0x07,
    "Coax":      0x08,
    "Optical":   0x09,
    "Analog 1":  0x0A,
    "Analog 2":  0x0B,
    "Phono":     0x0C,
    "Bluetooth": 0x0D,
    "Network":   0x0E,
}
SOURCES_REVERSE = {v: k for k, v in SOURCES.items()}

SURROUND_MODES: dict[str, int] = {
    "Dolby Surround": 0x01,
    "DTS Neural:X":   0x02,
    "Stereo 2.0":     0x03,
    "Stereo 2.1":     0x04,
    "All Stereo":     0x05,
    "Native":         0x06,
}
SURROUND_MODES_REVERSE = {v: k for k, v in SURROUND_MODES.items()}


STREAMING_SERVERS: dict[int, str] = {
    0:  None,
    4:  "USB",
    9:  "TuneIn",
    10: "UPnP",
    11: "QPlay",
    12: "Bluetooth",
    13: "AirPlay",
    15: "Spotify",
    16: "Google Cast",
    17: "Airable Radio",
    18: "Airable Podcasts",
    19: "Napster",
    20: "Qobuz",
    21: "Deezer",
    22: "Tidal",
    23: "Roon",
    26: "Amazon Music",
    33: "Pandora",
}
PLAY_STATES = {0: "stopped", 1: "playing", 2: "paused"}

# State-bearing commands we want to cache
STATE_CMDS = {CMD_POWER, CMD_VOLUME, CMD_MUTE, CMD_INPUT, CMD_SURROUND, CMD_TREBLE, CMD_BASS, CMD_STREAMING}


def _build_command(cmd_id: int, *data: int) -> bytes:
    return bytes([START_BYTE, cmd_id, len(data), *data, END_BYTE])


class _FrameParser:
    """
    Incrementally parse the AVR byte stream into response frames.

    AVR response format:
        0x02  0x23  <cmdId>  <rspCode>  <dataLen>  [data…]  0x0D
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, chunk: bytes) -> list[dict[str, Any]]:
        self._buf.extend(chunk)
        frames: list[dict[str, Any]] = []

        while True:
            # Locate 0x02 0x23 start sequence
            idx = -1
            for i in range(len(self._buf) - 1):
                if self._buf[i] == RSP_START_0 and self._buf[i + 1] == RSP_START_1:
                    idx = i
                    break

            if idx == -1:
                self._buf = self._buf[-1:] if self._buf else bytearray()
                break

            if idx > 0:
                self._buf = self._buf[idx:]

            # Need at least: 0x02 0x23 cmdId rspCode dataLen END = 6 bytes
            if len(self._buf) < 6:
                break

            data_len = self._buf[4]
            frame_len = 5 + data_len + 1

            if len(self._buf) < frame_len:
                break

            frame = self._buf[:frame_len]

            if frame[-1] != END_BYTE:
                _LOGGER.warning("JBL: bad frame end 0x%02X, resyncing", frame[-1])
                self._buf = self._buf[2:]
                continue

            frames.append({
                "cmd_id":   frame[2],
                "rsp_code": frame[3],
                "payload":  list(frame[5: 5 + data_len]),
            })
            self._buf = self._buf[frame_len:]

        return frames


class JBLClient:
    """
    Persistent async TCP client for the JBL MA Series IP control protocol.

    Handles:
    - Long-lived TCP connection with automatic reconnect after drop
    - Background reader that dispatches frames to waiters or push_callback
    - Optimistic state cache updated by all responses AND unsolicited pushes
    - Power-off gracefully handled: AVR drops the connection when it goes to
      standby; we set power=False in cache immediately, then attempt reconnect
      once the AVR wakes up again (polled by the coordinator)
    """

    def __init__(self, host: str, port: int = 50000, timeout: float = 5.0) -> None:
        self._host = host
        self._port = port
        self._timeout = timeout

        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._bg_task: asyncio.Task | None = None
        self._cmd_lock = asyncio.Lock()
        self._waiters: dict[int, asyncio.Future] = {}

        # Called immediately when the AVR pushes an unsolicited state change.
        self.push_callback: Callable[[dict], None] | None = None

        # Authoritative state cache
        self.state: dict[str, Any] = {
            "power":          None,
            "volume":         None,
            "mute":           None,
            "source":         None,
            "surround_mode":  None,
            "treble":         None,
            "bass":           None,
            "stream_service": None,
            "stream_state":   None,
        }

    @property
    def host(self) -> str:
        return self._host

    # ------------------------------------------------------------------ #
    # Connection                                                           #
    # ------------------------------------------------------------------ #

    async def connect(self) -> bool:
        """Open the TCP connection and send the init handshake."""
        await self._close_transport()
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self._host, self._port),
                timeout=self._timeout,
            )
        except (OSError, asyncio.TimeoutError) as exc:
            _LOGGER.debug("JBL MA710: connect failed: %s", exc)
            return False

        self._bg_task = asyncio.ensure_future(self._reader_loop())

        resp = await self._send_and_wait(CMD_INIT, REQUEST)
        if resp is None or resp["rsp_code"] != RSP_OK:
            _LOGGER.error("JBL MA710: init handshake failed")
            await self._close_transport()
            return False

        _LOGGER.info("JBL MA710: connected to %s", self._host)
        return True

    async def disconnect(self) -> None:
        """Full teardown — called on HA unload."""
        if self._bg_task and not self._bg_task.done():
            self._bg_task.cancel()
            try:
                await self._bg_task
            except asyncio.CancelledError:
                pass
        self._bg_task = None
        await self._close_transport()

    async def _close_transport(self) -> None:
        """Close writer without cancelling the bg task."""
        if self._writer:
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
        self._reader = None
        self._writer = None

    def _connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    # ------------------------------------------------------------------ #
    # Background reader loop                                               #
    # ------------------------------------------------------------------ #

    async def _reader_loop(self) -> None:
        parser = _FrameParser()
        assert self._reader
        try:
            while True:
                chunk = await self._reader.read(512)
                if not chunk:
                    _LOGGER.info("JBL MA710: connection closed by device (standby?)")
                    break
                _LOGGER.debug("JBL MA710 RX: %s", chunk.hex())
                for frame in parser.feed(chunk):
                    self._on_frame(frame)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            _LOGGER.error("JBL MA710: reader error: %s", exc)
        finally:
            # Transport is gone — mark as disconnected
            self._reader = None
            if self._writer:
                try:
                    self._writer.close()
                except Exception:
                    pass
            self._writer = None

            # Cancel any commands waiting for a response
            for fut in self._waiters.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("connection lost"))
            self._waiters.clear()

            # The AVR drops the TCP connection when it goes to standby.
            # Update power state to off and notify HA immediately so the
            # entity reflects reality without waiting for the next poll.
            if self.state.get("power") is not False:
                _LOGGER.info("JBL MA710: connection lost — marking power OFF")
                self.state["power"] = False
                if self.push_callback is not None:
                    self.push_callback(dict(self.state))

    # ------------------------------------------------------------------ #
    # Frame dispatch                                                       #
    # ------------------------------------------------------------------ #

    def _on_frame(self, frame: dict[str, Any]) -> None:
        """Dispatch a parsed frame to a waiter or push_callback."""
        cmd_id = frame["cmd_id"]
        _LOGGER.debug(
            "JBL MA710 frame: cmd=0x%02X rsp=0x%02X payload=%s",
            cmd_id, frame["rsp_code"], frame["payload"],
        )

        # Always update state cache for OK frames that carry state info
        if frame["rsp_code"] == RSP_OK:
            self._cache(frame)

        fut = self._waiters.get(cmd_id)
        if fut and not fut.done():
            # This is a direct response to one of our sent commands
            fut.set_result(frame)
        elif frame["rsp_code"] == RSP_OK and cmd_id in STATE_CMDS:
            # No waiter = unsolicited push from front panel / remote / AVR internals
            # Fire immediately so HA reflects it without waiting for next poll
            _LOGGER.debug("JBL MA710: unsolicited push cmd=0x%02X → notifying HA", cmd_id)
            if self.push_callback is not None:
                self.push_callback(dict(self.state))

    def _cache(self, frame: dict[str, Any]) -> None:
        """Update state cache from any OK response."""
        cmd_id  = frame["cmd_id"]
        payload = frame["payload"]
        if not payload:
            return
        if cmd_id == CMD_POWER:
            self.state["power"] = payload[0] == 0x01
        elif cmd_id == CMD_VOLUME:
            self.state["volume"] = payload[0]
        elif cmd_id == CMD_MUTE:
            self.state["mute"] = payload[0] == 0x01
        elif cmd_id == CMD_INPUT:
            self.state["source"] = SOURCES_REVERSE.get(payload[0])
        elif cmd_id == CMD_SURROUND:
            self.state["surround_mode"] = SURROUND_MODES_REVERSE.get(payload[0])
        elif cmd_id == CMD_TREBLE:
            # 0x00-0x0C = +0 to +12dB, 0xFF-0xF4 = -1 to -12dB
            raw = payload[0]
            self.state["treble"] = raw if raw <= 0x0C else -(256 - raw)
        elif cmd_id == CMD_BASS:
            raw = payload[0]
            self.state["bass"] = raw if raw <= 0x0C else -(256 - raw)
        elif cmd_id == CMD_STREAMING:
            if len(payload) >= 2:
                self.state["stream_service"] = STREAMING_SERVERS.get(payload[0])
                self.state["stream_state"]   = PLAY_STATES.get(payload[1])

    # ------------------------------------------------------------------ #
    # Core command sender                                                  #
    # ------------------------------------------------------------------ #

    async def _send_and_wait(
        self, cmd_id: int, *data: int
    ) -> dict[str, Any] | None:
        """Register a Future, write the command, await the matching response."""
        async with self._cmd_lock:
            if not self._connected():
                return None

            loop = asyncio.get_event_loop()
            fut: asyncio.Future = loop.create_future()
            self._waiters[cmd_id] = fut

            try:
                pkt = _build_command(cmd_id, *data)
                _LOGGER.debug("JBL MA710 TX: %s", pkt.hex())
                self._writer.write(pkt)  # type: ignore[union-attr]
                await self._writer.drain()  # type: ignore[union-attr]
                return await asyncio.wait_for(asyncio.shield(fut), timeout=self._timeout)
            except asyncio.TimeoutError:
                _LOGGER.warning("JBL MA710: timeout cmd=0x%02X", cmd_id)
                return None
            except Exception as exc:
                _LOGGER.error("JBL MA710: command error cmd=0x%02X: %s", cmd_id, exc)
                return None
            finally:
                self._waiters.pop(cmd_id, None)
                if not fut.done():
                    fut.cancel()

    async def _cmd(self, cmd_id: int, *data: int) -> dict[str, Any] | None:
        """Send a command, reconnecting once if the socket is gone."""
        if not self._connected():
            if not await self.connect():
                return None
        resp = await self._send_and_wait(cmd_id, *data)
        if resp is None and not self._connected():
            if await self.connect():
                resp = await self._send_and_wait(cmd_id, *data)
        return resp

    # ------------------------------------------------------------------ #
    # Polling                                                              #
    # ------------------------------------------------------------------ #

    async def poll_state(self) -> dict[str, Any]:
        """
        Poll all state variables.  Returns cached state even on failure so
        the coordinator never sees a None-only dict just because the AVR is
        temporarily unreachable.

        If the AVR is in standby the connect() will fail and we preserve the
        last known state (power=False set by _reader_loop on disconnect).
        """
        if not self._connected():
            connected = await self.connect()
            if not connected:
                # AVR unreachable — keep last known state, don't clobber power=False
                _LOGGER.debug("JBL MA710: poll skipped (not reachable)")
                return dict(self.state)

        for cmd_id in (CMD_POWER, CMD_VOLUME, CMD_MUTE, CMD_INPUT, CMD_SURROUND, CMD_TREBLE, CMD_BASS, CMD_STREAMING):
            resp = await self._send_and_wait(cmd_id, REQUEST)
            if resp is None:
                _LOGGER.debug("JBL MA710: no response polling cmd=0x%02X", cmd_id)

        return dict(self.state)

    # ------------------------------------------------------------------ #
    # Power                                                                #
    # ------------------------------------------------------------------ #

    async def set_power(self, on: bool) -> bool:
        if on:
            # Turning on: connect if needed, then send command
            resp = await self._cmd(CMD_POWER, 0x01)
        else:
            # Turning off: send command; AVR will drop the connection itself.
            # Optimistically update state immediately — the reader_loop will
            # also set power=False when it detects the connection drop.
            resp = await self._cmd(CMD_POWER, 0x00)
            self.state["power"] = False

        if resp and resp["rsp_code"] == RSP_OK:
            self.state["power"] = on
            return True
        # Even if we got no response (AVR dropped mid-command during power-off)
        # treat it as success if we deliberately sent the off command
        if not on:
            return True
        return False

    # ------------------------------------------------------------------ #
    # Volume                                                               #
    # ------------------------------------------------------------------ #

    async def set_volume(self, volume: int) -> bool:
        vol = max(0, min(99, int(volume)))
        resp = await self._cmd(CMD_VOLUME, vol)
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["volume"] = vol
            return True
        return False

    # ------------------------------------------------------------------ #
    # Mute                                                                 #
    # ------------------------------------------------------------------ #

    async def set_mute(self, mute: bool) -> bool:
        resp = await self._cmd(CMD_MUTE, 0x01 if mute else 0x00)
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["mute"] = mute
            return True
        return False

    # ------------------------------------------------------------------ #
    # Source                                                               #
    # ------------------------------------------------------------------ #

    async def set_source(self, source_name: str) -> bool:
        source_id = SOURCES.get(source_name)
        if source_id is None:
            _LOGGER.error("JBL MA710: unknown source: %s", source_name)
            return False
        resp = await self._cmd(CMD_INPUT, source_id)
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["source"] = source_name
            return True
        return False

    # ------------------------------------------------------------------ #
    # Surround mode                                                        #
    # ------------------------------------------------------------------ #

    async def set_surround_mode(self, mode_name: str) -> bool:
        mode_id = SURROUND_MODES.get(mode_name)
        if mode_id is None:
            return False
        resp = await self._cmd(CMD_SURROUND, mode_id)
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["surround_mode"] = mode_name
            return True
        return False

    # ------------------------------------------------------------------ #
    # Treble / Bass EQ                                                     #
    # ------------------------------------------------------------------ #

    def _eq_to_byte(self, db: int) -> int:
        """Convert dB value (-12 to +12) to AVR byte encoding."""
        db = max(-12, min(12, int(db)))
        return db if db >= 0 else (256 + db)

    async def set_treble(self, db: int) -> bool:
        resp = await self._cmd(CMD_TREBLE, self._eq_to_byte(db))
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["treble"] = db
            return True
        return False

    async def set_bass(self, db: int) -> bool:
        resp = await self._cmd(CMD_BASS, self._eq_to_byte(db))
        if resp and resp["rsp_code"] == RSP_OK:
            self.state["bass"] = db
            return True
        return False

    # ------------------------------------------------------------------ #
    # Heartbeat                                                            #
    # ------------------------------------------------------------------ #

    async def heartbeat(self) -> bool:
        resp = await self._cmd(CMD_HEARTBEAT)
        return resp is not None and resp["rsp_code"] == RSP_OK
