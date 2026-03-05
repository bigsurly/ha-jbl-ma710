"""JBL MA710 Home Assistant Integration."""
from __future__ import annotations

import logging
import shutil
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .jbl_client import JBLClient

_LOGGER = logging.getLogger(__name__)

DOMAIN = "jbl_ma710"
PLATFORMS = [Platform.MEDIA_PLAYER]
UPDATE_INTERVAL = timedelta(seconds=30)

CARD_FILENAME = "jbl-ma710-card.js"
CARD_DEST_DIR = "www/community/jbl-ma710-card"
LOVELACE_RESOURCE_URL = "/local/community/jbl-ma710-card/jbl-ma710-card.js"


async def _async_install_card(hass: HomeAssistant) -> None:
    """Copy the Lovelace card JS into www and register it as a Lovelace resource."""
    # The www folder lives two levels up from this file inside the repo
    src = Path(__file__).parent.parent.parent / "www" / CARD_FILENAME
    if not src.exists():
        _LOGGER.warning("JBL MA710: card source not found at %s — skipping auto-install", src)
        return

    dest_dir = Path(hass.config.path(CARD_DEST_DIR))
    dest = dest_dir / CARD_FILENAME
    dest_dir.mkdir(parents=True, exist_ok=True)

    await hass.async_add_executor_job(shutil.copy2, str(src), str(dest))
    _LOGGER.debug("JBL MA710: card copied to %s", dest)

    # Register as a Lovelace resource if not already present
    try:
        resources = hass.data.get("lovelace", {}).get("resources")
        if resources and hasattr(resources, "async_items"):
            existing = [r["url"] for r in resources.async_items()]
            if LOVELACE_RESOURCE_URL not in existing:
                await resources.async_create_item({
                    "res_type": "module",
                    "url": LOVELACE_RESOURCE_URL,
                })
                _LOGGER.info(
                    "JBL MA710: Lovelace resource registered — %s",
                    LOVELACE_RESOURCE_URL,
                )
        else:
            _LOGGER.info(
                "JBL MA710: card copied but could not auto-register resource. "
                "Add manually: Settings → Dashboards → Resources → %s (JavaScript Module)",
                LOVELACE_RESOURCE_URL,
            )
    except Exception as exc:  # noqa: BLE001
        _LOGGER.warning(
            "JBL MA710: card copied but resource registration failed (%s). "
            "Add manually: Settings → Dashboards → Resources → %s (JavaScript Module)",
            exc,
            LOVELACE_RESOURCE_URL,
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_install_card(hass)

    host = entry.data[CONF_HOST]
    port = entry.data.get(CONF_PORT, 50000)

    client = JBLClient(host, port)
    coordinator = JBLCoordinator(hass, client)

    client.push_callback = coordinator.async_push_update

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
        db = int(call.data.get("bass", 0))
        for data in hass.data[DOMAIN].values():
            await data["client"].set_bass(db)
            data["coordinator"].async_set_updated_data(dict(data["client"].state))

    async def handle_set_treble(call):
        db = int(call.data.get("treble", 0))
        for data in hass.data[DOMAIN].values():
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
        _LOGGER.debug("JBL MA710: push update → %s", state)
        self.async_set_updated_data(state)

    async def _async_update_data(self) -> dict:
        try:
            state = await self.client.poll_state()
        except Exception as exc:
            _LOGGER.warning("JBL MA710: poll error: %s", exc)
            state = dict(self.client.state)

        if state.get("power") is None and all(v is None for v in state.values()):
            raise UpdateFailed("JBL MA710 unreachable and no cached state")

        return state