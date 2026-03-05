"""JBL MA710 Media Player Entity."""
from __future__ import annotations

import logging

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import DOMAIN, JBLCoordinator
from .jbl_client import SOURCES, SURROUND_MODES, JBLClient

_LOGGER = logging.getLogger(__name__)

SUPPORTED_FEATURES = (
    MediaPlayerEntityFeature.TURN_ON
    | MediaPlayerEntityFeature.TURN_OFF
    | MediaPlayerEntityFeature.VOLUME_SET
    | MediaPlayerEntityFeature.VOLUME_STEP
    | MediaPlayerEntityFeature.VOLUME_MUTE
    | MediaPlayerEntityFeature.SELECT_SOURCE
    | MediaPlayerEntityFeature.SELECT_SOUND_MODE
)

VOLUME_STEP = 2


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    data = hass.data[DOMAIN][entry.entry_id]
    coordinator: JBLCoordinator = data["coordinator"]
    client: JBLClient = data["client"]
    async_add_entities([JBLMediaPlayer(coordinator, client, entry)])


class JBLMediaPlayer(CoordinatorEntity, MediaPlayerEntity):
    """JBL MA710 media player entity."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_source_list = list(SOURCES.keys())
    _attr_sound_mode_list = list(SURROUND_MODES.keys())
    _attr_supported_features = SUPPORTED_FEATURES

    def __init__(
        self,
        coordinator: JBLCoordinator,
        client: JBLClient,
        entry: ConfigEntry,
    ) -> None:
        super().__init__(coordinator)
        self._client = client
        self._attr_unique_id = f"jbl_ma710_{client.host}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, client.host)},
            name="JBL MA710",
            manufacturer="JBL / Harman",
            model="MA710",
        )

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    @property
    def _d(self) -> dict:
        """Current state dict — prefer coordinator data, fall back to client cache."""
        return self.coordinator.data or self._client.state

    def _push_state(self) -> None:
        """
        After a command, push the client's updated cache into the coordinator
        and tell HA to re-render immediately.  This avoids the entity reading
        stale coordinator.data between now and the next poll/push.
        """
        self.coordinator.async_set_updated_data(dict(self._client.state))

    # ------------------------------------------------------------------ #
    # State properties                                                     #
    # ------------------------------------------------------------------ #

    @property
    def state(self) -> MediaPlayerState | None:
        power = self._d.get("power")
        if power is None:
            # Genuinely unknown — HA shows unavailable
            return None
        return MediaPlayerState.ON if power else MediaPlayerState.OFF

    @property
    def volume_level(self) -> float | None:
        vol = self._d.get("volume")
        return vol / 99.0 if vol is not None else None

    @property
    def is_volume_muted(self) -> bool | None:
        return self._d.get("mute")

    @property
    def source(self) -> str | None:
        return self._d.get("source")

    @property
    def sound_mode(self) -> str | None:
        return self._d.get("surround_mode")

    # ------------------------------------------------------------------ #
    # Commands                                                             #
    # ------------------------------------------------------------------ #

    async def async_turn_on(self) -> None:
        await self._client.set_power(True)
        self._push_state()

    async def async_turn_off(self) -> None:
        await self._client.set_power(False)
        self._push_state()

    async def async_set_volume_level(self, volume: float) -> None:
        await self._client.set_volume(int(round(volume * 99)))
        self._push_state()

    async def async_volume_up(self) -> None:
        current = self._d.get("volume") or 0
        await self._client.set_volume(min(99, current + VOLUME_STEP))
        self._push_state()

    async def async_volume_down(self) -> None:
        current = self._d.get("volume") or 0
        await self._client.set_volume(max(0, current - VOLUME_STEP))
        self._push_state()

    async def async_mute_volume(self, mute: bool) -> None:
        await self._client.set_mute(mute)
        self._push_state()

    async def async_select_source(self, source: str) -> None:
        await self._client.set_source(source)
        self._push_state()

    async def async_select_sound_mode(self, sound_mode: str) -> None:
        await self._client.set_surround_mode(sound_mode)
        self._push_state()

    @property
    def extra_state_attributes(self) -> dict:
        """Expose bass, treble, and streaming info as entity attributes."""
        return {
            "bass":           self._d.get("bass"),
            "treble":         self._d.get("treble"),
            "stream_service": self._d.get("stream_service"),
            "stream_state":   self._d.get("stream_state"),
        }

    async def async_set_bass(self, bass: int) -> None:
        await self._client.set_bass(bass)
        self._push_state()

    async def async_set_treble(self, treble: int) -> None:
        await self._client.set_treble(treble)
        self._push_state()
