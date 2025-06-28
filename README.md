# WinCC Unified MCP Server

A Model Context Protocol (MCP) server designed to interface with SIEMENS WinCC Unified SCADA systems via their GraphQL API. This server exposes various WinCC Unified functionalities as MCP tools, allowing AI assistants and other MCP-compatible clients to interact with the SCADA system.

## Features

-   Connects to a WinCC Unified GraphQL endpoint.
-   Provides MCP tools for:
    -   User authentication (`login-user`).
    -   Browsing SCADA objects (`browse-objects`).
    -   Reading current tag values (`get-tag-values`).
    -   Querying historical/logged tag data (`get-logged-tag-values`).
    -   Fetching active alarms (`get-active-alarms`).
    -   Fetching logged alarms (`get-logged-alarms`).
    -   Writing values to tags (`write-tag-values`).
    -   Acknowledging alarms (`acknowledge-alarms`).
    -   Resetting alarms (`reset-alarms`).
-   Supports an optional automatic service account login and token refresh mechanism.

## Prerequisites

-   Node.js (v18.x or later recommended).
-   npm (which typically comes with Node.js).
-   Access to a running WinCC Unified GraphQL server endpoint.

## Configuration

The server is configured using environment variables:

-   `GRAPHQL_URL`: **Required**. The full URL of your WinCC Unified GraphQL server.
    Example: `https://your-wincc-server.example.com/graphql`
-   `GRAPHQL_USR`: (Optional) Username for a service account. If provided along with `GRAPHQL_PWD`, the server will attempt to log in with these credentials on startup and periodically (every minute) to maintain a session. This token is stored globally and used by tools if a user-specific login hasn't occurred.
-   `GRAPHQL_PWD`: (Optional) Password for the service account.

**Example environment variable setup (Linux/macOS):**
```bash
export GRAPHQL_URL="http://localhost:4000/graphql"
export GRAPHQL_USR="username1"
export GRAPHQL_PWD="password1"
export NODE_TLS_REJECT_UNAUTHORIZED=0 # Set to 0 to disable TLS certificate validation (development only)
```

## How to Start

1.  **Navigate to the project directory.**

2.  **Install dependencies:**
    If you haven't already, install the necessary Node.js packages:
    ```bash
    npm install
    ```

3.  **Set Environment Variables:**
    Ensure the `GRAPHQL_URL` (and optionally `GRAPHQL_USR`, `GRAPHQL_PWD`) environment variables are set as described in the "Configuration" section.

4.  **Run the server:**
    You can use the provided `run.sh` script (on Linux/macOS):
    ```bash
    ./run.sh
    ```
    The `run.sh` script executes `export NODE_TLS_REJECT_UNAUTHORIZED=0` before starting the server with `node index.js`. The `NODE_TLS_REJECT_UNAUTHORIZED=0` setting disables TLS certificate validation, which might be necessary if your WinCC Unified GraphQL server uses HTTPS with a self-signed or internally-issued certificate.
    **Warning:** Disabling certificate validation (`NODE_TLS_REJECT_UNAUTHORIZED=0`) should only be done in trusted development or internal network environments, as it bypasses important security checks.

    Alternatively, you can run the server directly:
    ```bash
    # On Linux/macOS, if your GraphQL server uses HTTPS with a self-signed certificate:
    # export NODE_TLS_REJECT_UNAUTHORIZED=0
    # On Windows (PowerShell), if needed:
    # $env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

    node index.js
    ```

The MCP server will start and listen on port `3000` by default. MCP requests are expected at the `/mcp` endpoint (e.g., `http://localhost:3000/mcp`).

## Disclaimer

**Security Notice:** This server has not been hardened or secured for production use. It is the responsibility of the user to implement appropriate security measures (such as authentication, authorization, network restrictions, and HTTPS) before deploying or exposing this server in any environment.

## Connecting with a Claude Desktop Client

To use this MCP server with the Claude AI desktop application (or other clients supporting `mcp-remote`), you need to configure the client to connect to this server. For the Claude Desktop application, this is typically done by editing a `claude_desktop_config.json` file. The location of this file varies by operating system but is usually within the Claude application's support or configuration directory.

Add or update the `mcpServers` section in your `claude_desktop_config.json` file like this:

```json
{
  "mcpServers": {
    "WinCC Unified": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

**Explanation:**

-   `"WinCC Unified"`: This is a user-defined name for this server connection that will appear in the Claude application. You can change it to something meaningful to you (e.g., `"WinCC_Unified_Plant_A"`).
-   `"command": "npx"`: This tells the client to use `npx` (Node Package Execute) to run the `mcp-remote` tool.
-   `"args": ["mcp-remote", "http://localhost:3000/mcp"]`:
    -   `mcp-remote`: This is the command-line MCP client. Ensure that `npx` can find it. You might need to install `@modelcontextprotocol/tools` globally (`npm install -g @modelcontextprotocol/tools`) or have it available in a project context accessible by `npx`.
    -   `http://localhost:3000/mcp`: This is the URL where your WinCC Unified MCP server is listening. Adjust the hostname and port if your server runs elsewhere or on a different port.

After saving this configuration, restart your Claude Desktop application. It should now list "WinCC Unified" (or your chosen name) as an available MCP server, allowing you to use its tools.

## Available Tools

The server exposes the following tools for interacting with WinCC Unified:

*   **`login-user`**:
    Logs a user in to WinCC Unified using username and password. Stores the session token for subsequent requests. It is optionally, because the MCP server could be started in the way that it is doing automatically a logon with the service account.

*   **`browse-objects`**:
    Queries tags, elements, types, alarms, logging tags and basically anything that has a configured name, based on the provided filter criteria.
    
*   **`get-tag-values`**:
    Queries tag values from WinCC Unified. Based on the provided names list. If directRead is true, values are taken directly from PLC.

*   **`get-logged-tag-values`**:
    Queries logged tag values from the database.

*   **`get-active-alarms`**:
    Query active alarms from the provided systems.

*   **`get-logged-alarms`**:
    Query logged alarms from the storage system.

*   **`write-tag-values`**:
    Updates tags, based on the provided TagValueInput list.

*   **`acknowledge-alarms`**:
    Acknowledge one or more alarms.
    Each alarm identifier must have the name of the configured alarm, and optionally an instanceID. If the instanceID is 0 or not provided, all instances of the given alarm will be acknowledged.

*   **`reset-alarms`**:
    Reset one or more alarms.
    Each alarm identifier must have the name of the configured alarm, and optionally an instanceID. If the instanceID is 0 or not provided, all instances of the given alarm will be reset.