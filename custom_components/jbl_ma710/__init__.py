"""JBL MA710 Home Assistant Integration."""
from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .jbl_client import JBLClient

_LOGGER = logging.getLogger(__name__)

DOMAIN = "jbl_ma710"
PLATFORMS = [Platform.MEDIA_PLAYER]

# Poll is a safety-net / reconnect heartbeat only.
# All real-time updates come via push_callback from the background reader.
UPDATE_INTERVAL = timedelta(seconds=30)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    host = entry.data[CONF_HOST]
    port = entry.data.get(CONF_PORT, 50000)

    client = JBLClient(host, port)
    coordinator = JBLCoordinator(hass, client)

    # Wire push callback BEFORE connecting so we catch early frames
    client.push_callback = coordinator.async_push_update

    # Try initial connect; failure is non-fatal (AVR might be in standby)
    if not await client.connect():
        _LOGGER.warning("JBL MA710: initial connect failed (AVR in standby?)")

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "coordinator": coordinator,
        "client": client,
    }

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register bass/treble EQ services
    async def handle_set_bass(call):
        entity_id = call.data.get("entity_id")
        db = int(call.data.get("bass", 0))
        for eid, data in hass.data[DOMAIN].items():
            if data["client"].host in entity_id:
                await data["client"].set_bass(db)
                data["coordinator"].async_set_updated_data(dict(data["client"].state))

    async def handle_set_treble(call):
        entity_id = call.data.get("entity_id")
        db = int(call.data.get("treble", 0))
        for eid, data in hass.data[DOMAIN].items():
            if data["client"].host in entity_id:
                await data["client"].set_treble(db)
                data["coordinator"].async_set_updated_data(dict(data["client"].state))

    hass.services.async_register(DOMAIN, "set_bass",   handle_set_bass)
    hass.services.async_register(DOMAIN, "set_treble", handle_set_treble)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        data = hass.data[DOMAIN].pop(entry.entry_id)
        await data["client"].disconnect()
    return unload_ok


class JBLCoordinator(DataUpdateCoordinator):
    """
    Coordinator for the JBL MA710.

    Two update paths:
    1. Scheduled poll (every 30s) — reconnect recovery and safety-net sync.
    2. push_callback (immediate) — called by the background reader on any
       unsolicited AVR state push OR when the TCP connection drops (power off).
    """

    def __init__(self, hass: HomeAssistant, client: JBLClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=UPDATE_INTERVAL,
        )
        self.client = client

    def async_push_update(self, state: dict) -> None:
        """
        Called by the client immediately on any pushed state change.
        async_set_updated_data() updates self.data and fires all listeners
        synchronously on the HA event loop — no poll timer delay.
        """
        _LOGGER.debug("JBL MA710: push update → %s", state)
        self.async_set_updated_data(state)

    async def _async_update_data(self) -> dict:
        """
        Scheduled poll. Attempts reconnect if disconnected.
        Never raises UpdateFailed for a powered-off AVR — we preserve
        the cached state so HA shows 'off' rather than 'unavailable'.
        """
        try:
            state = await self.client.poll_state()
        except Exception as exc:
            _LOGGER.warning("JBL MA710: poll error: %s", exc)
            state = dict(self.client.state)

        # Only fail hard if we have literally never gotten any data at all
        if state.get("power") is None and all(v is None for v in state.values()):
            raise UpdateFailed("JBL MA710 unreachable and no cached state")

        return state
