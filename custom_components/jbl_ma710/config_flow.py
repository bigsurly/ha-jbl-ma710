"""Config flow for JBL MA710 integration."""
from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.data_entry_flow import FlowResult

from .jbl_client import JBLClient

DOMAIN = "jbl_ma710"
DEFAULT_PORT = 50000


class JBLConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for JBL MA710."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]
            port = user_input.get(CONF_PORT, DEFAULT_PORT)

            # Test the connection
            client = JBLClient(host, port)
            connected = await client.connect()
            await client.disconnect()

            if connected:
                await self.async_set_unique_id(host)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"JBL MA710 ({host})",
                    data={CONF_HOST: host, CONF_PORT: port},
                )
            else:
                errors["base"] = "cannot_connect"

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): str,
                vol.Optional(CONF_PORT, default=DEFAULT_PORT): int,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )
