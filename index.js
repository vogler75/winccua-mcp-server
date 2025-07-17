/*
 * Created by Andreas Vogler 2025
 *
 * A model context protocol server for WinCC Unified based on its graphql server
 * 
*/


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from 'express';
import https from 'https';

// Define the URL of your WinCC Unified GraphQL server
// IMPORTANT: Replace with your actual GraphQL server endpoint
const WINCC_UNIFIED_GRAPHQL_URL = process.env.GRAPHQL_URL || "http://localhost:4000/graphql"; // Example URL
const WINCC_UNIFIED_GRAPHQL_USR = process.env.GRAPHQL_USR || "username1";
const WINCC_UNIFIED_GRAPHQL_PWD = process.env.GRAPHQL_PWD || "password1";

// Create an HTTPS agent that ignores self-signed certificate errors
// WARNING: Use with caution, only for development or trusted internal networks.
const agentToUse = WINCC_UNIFIED_GRAPHQL_URL.startsWith('https://')
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

console.log("WinCC Unified GraphQL URL: ", WINCC_UNIFIED_GRAPHQL_URL);

const sessionData = { usr:  WINCC_UNIFIED_GRAPHQL_USR, pwd: WINCC_UNIFIED_GRAPHQL_PWD, apiToken: null };

// if usr and pwd are defined, then call here every 1 minute a logon
if (sessionData.usr && sessionData.pwd) {
  const runServiceAccountLogon = async () => {
    try {
      const loginDetails = await logon(sessionData.usr, sessionData.pwd);
      if (loginDetails && loginDetails.token) {
        console.log(`[Service Logon] Periodic service account logon for '${loginDetails.user.name}' completed.`);
      }
    } catch (error) {
      // logon() already logs details of the failure, this catches errors from the await/async operation itself.
      console.error("[Service Logon] Error during scheduled service account logon:", error.message);
    }
  };
  runServiceAccountLogon(); // Run immediately for the first time
  setInterval(runServiceAccountLogon, 60000); // Then every 1 minute
}

// Create server instance
const server = new McpServer({
  name: "WinCC Unified Extended",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
  },
});


// ------------------------------------------------------------------------------------------------------------------------------------------------
// Enums and Input Validation
// ------------------------------------------------------------------------------------------------------------------------------------------------

const ObjectTypesEnumZod = z.enum([
  "TAG",
  "SIMPLETAG",
  "STRUCTURETAG",
  "TAGTYPE",
  "STRUCTURETAGTYPE",
  "SIMPLETAGTYPE",
  "ALARM",
  "ALARMCLASS",
  "LOGGINGTAG"
]);

const LoggedTagValuesSortingModeEnumZod = z.enum([
  "TIME_ASC",
  "TIME_DESC"
]);

const LoggedTagValuesBoundingModeEnumZod = z.enum([
  "NO_BOUNDING_VALUES",
  "LEFT_BOUNDING_VALUES",
  "RIGHT_BOUNDING_VALUES",
  "LEFTRIGHT_BOUNDING_VALUES"
]);

const MainQualityEnumZod = z.enum([
  "BAD",
  "UNCERTAIN",
  "GOOD_NON_CASCADE",
  "GOOD_CASCADE"
]);

const QualitySubStatusEnumZod = z.enum([
  "NON_SPECIFIC",
  "CONFIGURATION_ERROR", // Present in BAD group
  "NOT_CONNECTED",
  "SENSOR_FAILURE",
  "DEVICE_FAILURE",
  "NO_COMMUNICATION_WITH_LAST_USABLE_VALUE",
  "NO_COMMUNICATION_NO_USABLE_VALUE",
  "OUT_OF_SERVICE",
  "LAST_USABLE_VALUE", // Present in UNCERTAIN group
  "SUBSTITUTE_VALUE",
  "INITIAL_VALUE",
  "SENSOR_CONVERSION",
  "RANGE_VIOLATION",
  "SUB_NORMAL",
  "CONFIG_ERROR", // Present in UNCERTAIN group (Zod handles duplicate enum values if they are identical strings)
  "SIMULATED_VALUE",
  "SENSOR_CALIBRATION",
  "UPDATE_EVENT", // Present in GOOD (NON-CASCADE) group
  "ADVISORY_ALARM",
  "CRITICAL_ALARM",
  "UNACK_UPDATE_EVENT",
  "UNACK_ADVISORY_ALARM",
  "UNACK_CRITICAL_ALARM",
  "INIT_FAILSAFE", // Present in GOOD (NON-CASCADE, CASCADE) group
  "MAINTENANCE_REQUIRED",
  "INIT_ACKED", // Present in GOOD (CASCADE) group
  "INITREQ",
  "NOT_INVITED",
  "DO_NOT_SELECT",
  "LOCAL_OVERRIDE"
]);

const QualityInputZod = z.object({
  quality: MainQualityEnumZod,
  subStatus: QualitySubStatusEnumZod.optional()
});

const AlarmIdentifierInputZod = z.object({
  name: z.string().min(1, "Alarm name cannot be empty."),
  instanceID: z.number().int().optional().default(0),
});

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Function to log in a user to WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

async function logon(username, password) {
    const graphqlMutation = `
      mutation LoginUser($username: String!, $password: String!) {
        login(username: $username, password: $password) {
          token
          expires
          user {
            id
            name
            fullName
            language
          }
          error {
            code
            description
          }
        }
      }
    `;

    const variables = {
      username,
      password,
    };

    console.log(`[GraphQL Logon] Attempting logon via ${WINCC_UNIFIED_GRAPHQL_URL} for user: ${username}`);

    const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Use the insecure agent only if the URL is HTTPS
      agent: agentToUse,
      body: JSON.stringify({
        query: graphqlMutation,
        variables: variables,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`GraphQL login request failed with status ${response.status}: ${errorBody}`);
      throw new Error(`Login failed: ${response.status} - ${response.statusText}`);
    }

    const jsonResponse = await response.json();

    if (jsonResponse.errors) {
      console.error('GraphQL login errors:', JSON.stringify(jsonResponse.errors, null, 2));
      throw new Error(`Login failed: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
    }

    if (!jsonResponse.data || !jsonResponse.data.login || !jsonResponse.data.login.token) {
      const loginError = jsonResponse.data?.login?.error;
      const errorMessage = loginError ? `Login failed: ${loginError.description} (Code: ${loginError.code})` : "Login failed: Token not received in response.";
      console.error('GraphQL login response missing token or data.login:', JSON.stringify(jsonResponse, null, 2));
      throw new Error(errorMessage);
    }
    
    // Store the token in sessionData for this session
    sessionData.usr = username; // Update the username in sessionData
    sessionData.pwd = password; // Update the password in sessionData
    sessionData.apiToken = jsonResponse.data.login.token;

    return jsonResponse.data.login;   
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to log in a user to WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "login-user",
  `Logs a user in to WinCC Unified using username and password. 
   Stores the session token for subsequent requests. 
   It is optionally, because the MCP server could be started in the way that it is doing automatically a logon with the service account.
   `,
  {
    username: z.string().min(1, "Username cannot be empty."),
    password: z.string().min(1, "Password cannot be empty."),
  },
  async ({ username, password }, executionContext) => {
    console.log(`Tool 'login-user' called for username: ${username}`);

    try {   
      session = logon(username, password);     
      console.log(`User '${session.user.name}' logged in successfully. Token stored.`);
      return {
        content: [{
          type: "text",
          text: "Login successful. Session token stored."
        }]
      };
    } catch (error) {
      console.error("Error in 'login-user' tool during GraphQL call:", error);
      throw new Error(`Login attempt failed: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to browse objects in WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "browse-objects",
  `Queries tags, elements, types, alarms, logging tags and basically anything that has a configured name, based on the provided filter criteria.
  Each filter parameter can be an array, and the logical relation between each item is an "OR" relation.
  However, the logical relation between each filter parameter is "AND".
  The nameFilters parameter can be used to search for objects either with exact matching, or with wildcards (*, ?). This parameter can
  be very powerful: it can be used to filter just on HmiObject level, on specific hierarchy levels on HmiElement level, or Subelement level.
  Some rules regarding this: "*" matches generally any number of characters. "*::*" matches anything on object level. "*.*" matches
  anything on element level, but only on the first hierarchy level (e.g. it matches MySystem::MyStucturedTag.ParentElement, but does not
  match MySystem::MyStructuredTag.ParentElement.ChildElement). "*.**" matches elements on any hierarchy level, also the example before.
  "*.**:*" matches any subelement. For example, to get all elements and their subelements of a specific tag, one must provide two strings:
  "MySystem::MyExampleTag.**" and "MySystem::MyExampleTag.**:*". Note, that this example will still exclude MyExampleTag itself.
  To match anything based on name, the parameter should not be provided, it should be empty, or should contain only "*".

  The baseTypeFilters can be used to filter by object type name, e.g. "MySystem::MyStructureTagType". This will result in all the instances
  of the provided types. Note: this parameter does not support wildcards.

  The objectTypesFilter parameter can be used to provide some predefined HmiObjectTypes, and only items of this type or of its subtypes
  will be returned. E.g. providing the generic HmiObjectType TAG can return SIMPLETAGs and STRUCTURETAGs as well. The objectType attribute of the
  result will contain the exact HmiObjectType (i.e. no generic one). Note, that not all HmiObjectTypes are supported for filtering even if returned in the results.

  The language parameter defines, in which language the display name should be returned.

  All the parameters have default values, not providing them will result in the usage of these default values. For the filter parameters,
  it is an empty string, and the default language is "en-US". Providing explicitly null to any of the parameters will result in a rejected request.

  Pay attention to incompatible filters: e.g. mixing the object type "ALARM" with the nameFilter "*.*" will not return any result, because
  alarms are subElements, and they would be filtered out by this nameFilter.

  Errors:
    0 - Success
    1 - Generic error
    2 - Cannot resolve provided name
    3 - Argument error
  `,
  {
    nameFilters: z.array(z.string()).optional().default([]),
    objectTypeFilters: z.array(ObjectTypesEnumZod).optional().default([]),
    baseTypeFilters: z.array(z.string()).optional().default([]),
    language: z.string().optional().default("en-US"),
  },
  async ({ nameFilters, objectTypeFilters, baseTypeFilters, language }, executionContext) => {
    console.log(`Tool 'browse-objects' called with filters:`, { nameFilters, objectTypeFilters, baseTypeFilters, language });

    const graphqlQuery = `
      query BrowseObjects(
        $nameFilters: [String],
        $objectTypeFilters: [ObjectTypesEnum],
        $baseTypeFilters: [String],
        $language: String
      ) {
        browse(
          nameFilters: $nameFilters,
          objectTypeFilters: $objectTypeFilters,
          baseTypeFilters: $baseTypeFilters,
          language: $language
        ) {
          name
          displayName
          objectType
          dataType
        }
      }
    `;

    const variables = {
      nameFilters,
      objectTypeFilters,
      baseTypeFilters,
      language,
    };

    try {
      console.log(`[browse-objects] Attempting to fetch from: ${WINCC_UNIFIED_GRAPHQL_URL}`);
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) {
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse, // Use the globally defined agent for HTTPS
        body: JSON.stringify({
          query: graphqlQuery,
          variables: variables,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL browse request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`Browse request failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();

      if (jsonResponse.errors) {
        console.error('GraphQL browse errors:', JSON.stringify(jsonResponse.errors, null, 2));
        throw new Error(`Browse query errors: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
      }

      if (!jsonResponse.data || !jsonResponse.data.browse) {
        console.error('GraphQL browse response missing data.browse:', JSON.stringify(jsonResponse, null, 2));
        throw new Error("Received an unexpected response structure from GraphQL server for browse query.");
      }

      console.log('Successfully fetched browse results from GraphQL server. Number of items: ', jsonResponse.data.browse.length);
      return { content:[{ type: "text", text: JSON.stringify(jsonResponse.data.browse)}] };
    } catch (error) {
      console.error("Error in 'browse-objects' tool during GraphQL call:", error);
      throw new Error(`Failed to browse objects: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to get tag values from WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "get-tag-values",
  `Queries tag values from WinCC Unified. Based on the provided names list. If directRead is true, values are taken directly from PLC.
  The nameFilters parameter can be used to search for objects either with exact matching, or with wildcards (*, ?). T his parameter can
  be very powerful: it can be used to filter just on HmiObject level, on specific hierarchy levels on HmiElement level, or Subelement level.
  Some rules regarding this: "*" matches generally any number of characters. "*::*" matches anything on object level. "*.*" matches
  anything on element level, but only on the first hierarchy level (e.g. it matches MySystem::MyStucturedTag.ParentElement, but does not
  match MySystem::MyStructuredTag.ParentElement.ChildElement). "*.**" matches elements on any hierarchy level, also the example before.
  "*.**:*" matches any subelement. For example, to get all elements and their subelements of a specific tag, one must provide two strings:
  "MySystem::MyExampleTag.**" and "MySystem::MyExampleTag.**:*". Note, that this example will still exclude MyExampleTag itself.
  To match anything based on name, the parameter should not be provided, it should be empty, or should contain only "*".

  The baseTypeFilters can be used to filter by object type name, e.g. "MySystem::MyStructureTagType". This will result in all the instances
  of the provided types. Note: this parameter does not support wildcards.

  The objectTypesFilter parameter can be used to provide some predefined HmiObjectTypes, and only items of this type or of its subtypes
  will be returned. E.g. providing the generic HmiObjectType TAG can return SIMPLETAGs and STRUCTURETAGs as well. The objectType attribute of the
  result will contain the exact HmiObjectType (i.e. no generic one). Note, that not all HmiObjectTypes are supported for filtering even if returned in the results.

  The language parameter defines, in which language the display name should be returned.

  All the parameters have default values, not providing them will result in the usage of these default values. For the filter parameters,
  it is an empty string, and the default language is "en-US". Providing explicitly null to any of the parameters will result in a rejected request.

  Pay attention to incompatible filters: e.g. mixing the object type "ALARM" with the nameFilter "*.*" will not return any result, because
  alarms are subElements, and they would be filtered out by this nameFilter.

  Errors:
    0 - Success
    1 - Generic error
    2 - Cannot resolve provided name
    3 - Argument error  
  `,
  {
    names: z.array(z.string()).min(1, "At least one tag name must be provided."),
    directRead: z.boolean().optional().default(false), // Matches GraphQL default
  },
  async ({ names, directRead }, executionContext) => {
    console.log(`Tool 'get-tag-values' called with names: [${names.join(", ")}], directRead: ${directRead}`);

    const graphqlQuery = `
      query GetTagValues($names: [String!]!, $directRead: Boolean) {
        tagValues(names: $names, directRead: $directRead) {
          name
          value {
            value
            timestamp
            quality {
              quality
              subStatus
              limit
              extendedSubStatus
              sourceQuality
              sourceTime
              timeCorrected
            }
          }
          error {
            code
            description
          }
        }
      }
    `;

    const variables = {
      names,
      directRead,
    };

    try {
      const isHttps = WINCC_UNIFIED_GRAPHQL_URL.toLowerCase().startsWith('https:');

      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) {
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({
          query: graphqlQuery,
          variables: variables,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`GraphQL request failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();

      if (jsonResponse.errors) {
        console.error('GraphQL errors:', JSON.stringify(jsonResponse.errors, null, 2));
        // You might want to format this error more specifically
        throw new Error(`GraphQL query errors: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
      }

      if (!jsonResponse.data || !jsonResponse.data.tagValues) {
        console.error('GraphQL response missing data.tagValues:', JSON.stringify(jsonResponse, null, 2));
        throw new Error("Received an unexpected response structure from GraphQL server.");
      }

      console.log('Successfully fetched tagValues from GraphQL server.');
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data.tagValues)}] };
    } catch (error) {
      console.error("Error in 'get-tag-values' tool during GraphQL call:", error);
      // The McpServer will catch this error and format it as a JSON-RPC error.
      // Ensure the error message is informative for the client.
      throw new Error(`Failed to retrieve tag values: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to get logged tag values from WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "get-logged-tag-values",
  `Queries logged tag values from the database.
  Names is a mandatory parameter, each name in this list must either be a LoggingTag name or a Tag name.
  If either of the parameters startTime, endTime and maxNumberOfValues is not provided, it won't be used for filtering.
  However, at least one of the parameters startTime and endTime must be provided and if only one of them is provided,
  maxNumberOfValues must be provided, too. If only the startTime is provided, sortingMode must be TIME_ASC,
  and if only endTime is provided, it must be TIME_DESC, which defines the direction of the search from a point in time.
  The maxNumberOfValues parameter will be applied also according to this sorting mode, so e.g., in case of TIME_DESC and
  maxNumberOfValues = 100, maximum 100 values before the endTime will be returned. When both startTime and endTime are provided,
  the client is free to choose the sortingMode.
  The default sorting mode is TIME_ASC.

  The boundingValuesMode decides if values bounding the search interval are also returned. For example, if the startTime is today
  12:00, and LEFT_BOUNDING_VALUES is requested, the last value prior to this time point is also returned, even if it is much earlier,
  e.g. at yesterday evening. Such values will be marked with the BOUNDING flag in the result. Possible options are: no bounding values,
  earlier (LEFT), later (RIGHT), or both.
  The default is NO_BOUNDING_VALUES.

  Returned values can contain specific flags, which further specify attributes of these values. For details, check the descriptions
  of LoggedTagValueFlagsEnum members.

  Errors:
    0 - Success
    1 - Generic error
    2 - Cannot resolve provided name
    3 - Argument error
  `,
  {
    names: z.array(z.string()).min(1, "At least one tag name must be provided."),
    startTime: z.string().datetime({ message: "Invalid ISO 8601 datetime string for startTime" }).optional().default("1970-01-01T00:00:00.000Z"),
    endTime: z.string().datetime({ message: "Invalid ISO 8601 datetime string for endTime" }).optional().default("1970-01-01T00:00:00.000Z"),
    maxNumberOfValues: z.number().int().optional().default(0),
    sortingMode: LoggedTagValuesSortingModeEnumZod.optional().default("TIME_ASC"),
    boundingValuesMode: LoggedTagValuesBoundingModeEnumZod.optional().default("NO_BOUNDING_VALUES"),
  },
  async ({ names, startTime, endTime, maxNumberOfValues, sortingMode, boundingValuesMode }, executionContext) => {
    console.log(`Tool 'get-logged-tag-values' called with:`, { names, startTime, endTime, maxNumberOfValues, sortingMode, boundingValuesMode });

    const graphqlQuery = `
      query GetLoggedTagValues(
        $names: [String]!,
        $startTime: Timestamp,
        $endTime: Timestamp,
        $maxNumberOfValues: Int,
        $sortingMode: LoggedTagValuesSortingModeEnum,
        $boundingValuesMode: LoggedTagValuesBoundingModeEnum
      ) {
        loggedTagValues(
          names: $names,
          startTime: $startTime,
          endTime: $endTime,
          maxNumberOfValues: $maxNumberOfValues,
          sortingMode: $sortingMode,
          boundingValuesMode: $boundingValuesMode
        ) {
          loggingTagName
          error {
            code
            description
          }
          values {
            # We only need the direct value and timestamp from the nested Value object
            value {
              value
              timestamp
            }
          }
        }
      }
    `;

    const variables = {
      names,
      startTime,
      endTime,
      maxNumberOfValues,
      sortingMode,
      boundingValuesMode,
    };

    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) {
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse, // Use the globally defined agent for HTTPS
        body: JSON.stringify({
          query: graphqlQuery,
          variables: variables,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL loggedTagValues request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`LoggedTagValues request failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();

      if (jsonResponse.errors) {
        console.error('GraphQL loggedTagValues errors:', JSON.stringify(jsonResponse.errors, null, 2));
        throw new Error(`LoggedTagValues query errors: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
      }

      if (!jsonResponse.data || !jsonResponse.data.loggedTagValues) {
        console.error('GraphQL loggedTagValues response missing data.loggedTagValues:', JSON.stringify(jsonResponse, null, 2));
        throw new Error("Received an unexpected response structure from GraphQL server for loggedTagValues query.");
      }

      // Transform the GraphQL response to MCP table format
      const tableData = {
        columns: [
          { name: "Logging Tag Name", type: "string" },
          { name: "Timestamp", type: "datetime" },
          { name: "Value", type: "string" }, // Variant is best represented as string
        ],
        rows: []
      };

      if (jsonResponse.data && jsonResponse.data.loggedTagValues) {
        jsonResponse.data.loggedTagValues.forEach(tagResult => {
          const tagName = tagResult.loggingTagName;
          // const tagError = tagResult.error ? `Code ${tagResult.error.code}: ${tagResult.error.description}` : null; // Error not requested anymore

          if (tagResult.values && tagResult.values.length > 0) {
            tagResult.values.forEach(loggedVal => {
              // Ensure loggedVal.value exists before trying to access its properties
              if (loggedVal.value) {
                tableData.rows.push([
                  tagName,
                  loggedVal.value.timestamp || null,
                  loggedVal.value.value !== undefined && loggedVal.value.value !== null ? String(loggedVal.value.value) : null,
                ]);
              }
            });
          } else {
            // If there are no values for a tag, still list the tag name
            tableData.rows.push([tagName, null, null]);
          }
        });
      }

      // Function to format table data as plain text
      const formatTableAsText = (columns, rows) => {
        if (rows.length === 0) {
          return "No data available.";
        }

        const columnNames = columns.map(col => col.name);
        // Calculate column widths
        const columnWidths = columnNames.map((name, index) => {
          let maxWidth = name.length;
          rows.forEach(row => {
            const cellValue = row[index] !== null && row[index] !== undefined ? String(row[index]) : "";
            if (cellValue.length > maxWidth) {
              maxWidth = cellValue.length;
            }
          });
          return maxWidth;
        });

        // Create header
        let textTable = columnNames.map((name, index) => name.padEnd(columnWidths[index])).join(" | ") + "\n";
        textTable += columnWidths.map(width => "-".repeat(width)).join("-+-") + "\n";

        // Create rows
        rows.forEach(row => {
          textTable += row.map((cell, index) => {
            const cellValue = cell !== null && cell !== undefined ? String(cell) : "";
            return cellValue.padEnd(columnWidths[index]);
          }).join(" | ") + "\n";
        });
        return textTable;
      };

      const textFormattedTable = formatTableAsText(tableData.columns, tableData.rows);
      console.log("Successfully fetched logged tag values. Number of rows: ", tableData.rows.length);
      return { content:[{ type: "text", text: textFormattedTable }] };
    } catch (error) {
      console.error("Error in 'get-logged-tag-values' tool during GraphQL call:", error);
      throw new Error(`Failed to retrieve logged tag values: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to get active alarms from WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "get-active-alarms",
  `Query active alarms from the provided systems.
  The filterString parameter must be a valid ChromQueryLanguage (based on, and very similar to SQL) string,
  more specifically its WHERE part (without including the WHERE word itself).
  You can use most of the simple expressions in CQL, that are valid in SQL.
  The column names must be valid active alarm attributes, which corresponds to abut basically it can be interpreted as a single-table database in SQL.
  You can use wildcards (* to match with any number of characters, ? to replace exactly one character),
  less-than and greater-than, equal and similar operators, and you can use parentheses to group the expressions and connect them with logical operators such as OR or AND.
  If the filterString contains any comparison with multilingual texts, the filterLanguage parameter is used to decide,
  which language of the texts should be compared. All multilingual texts will be returned in the languages specified in the languages parameter.
  All language identifying parameters must be provided in ISO language code format (e.g. "en-US", "de-DE").
  The retrieved multilingual texts will be returned as arrays of strings, one element standing for one language specified,
  in the order they were passed. The 'languages' attribute can be selected, that will specify this order again,
  so they are available when processing the query.

  Errors:
    0 - Success
    301 - Syntax error in query string
    302 - At least one of the requested languages is invalid
    303 - The provided filter language is invalid
  `,
  {
    systemNames: z.array(z.string()).optional().default([]),
    filterString: z.string().optional().default(""),
    filterLanguage: z.string().optional().default("en-US"),
    languages: z.array(z.string()).optional().default(["en-US"]),
  },
  async ({ systemNames, filterString, filterLanguage, languages: requestedLanguages }, executionContext) => {
    console.log(`Tool 'get-active-alarms' called with:`, { systemNames, filterString, filterLanguage, languages: requestedLanguages });

    const graphqlQuery = `
      query GetActiveAlarms(
        $systemNames: [String],
        $filterString: String,
        $filterLanguage: String,
        $languages: [String]
      ) {
        activeAlarms(
          systemNames: $systemNames,
          filterString: $filterString,
          filterLanguage: $filterLanguage,
          languages: $languages
        ) {
          name
          instanceID
          raiseTime
          acknowledgmentTime
          clearTime
          modificationTime
          state
          priority
          eventText
          infoText
          languages # To know the order of multilingual texts
          # Add other ActiveAlarm fields as needed
        }
      }
    `;

    const variables = {
      systemNames,
      filterString,
      filterLanguage,
      languages: requestedLanguages,
    };

    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) { // Still using global sessionData as per current file structure
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({
          query: graphqlQuery,
          variables: variables,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL activeAlarms request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`ActiveAlarms request failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();

      if (jsonResponse.errors) {
        console.error('GraphQL activeAlarms errors:', JSON.stringify(jsonResponse.errors, null, 2));
        throw new Error(`ActiveAlarms query errors: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
      }

      console.log('Successfully fetched activeAlarms from GraphQL server. Number of alerts: ', jsonResponse.data?.activeAlarms?.length || 0);
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data?.activeAlarms || [], null, 2) }] };
    } catch (error) {
      console.error("Error in 'get-active-alarms' tool during GraphQL call:", error);
      throw new Error(`Failed to retrieve active alarms: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to get logged alarms from WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "get-logged-alarms",
  `Query logged alarms from the storage system.
  The filterString parameter must be a valid ChromQueryLanguage (based on, and very similar to SQL) string,
  more specifically its WHERE part (without including the WHERE word itself).
  You can use most of the simple expressions in CQL, that are valid in SQL.
  The column names must be valid logged alarm attributes.
  You can use wildcards (* to match with any number of characters, ? to replace exactly one character),
  less-than and greater-than, equal and similar operators, and you can use parentheses to group the expressions and connect them with logical operators such as OR or AND.
  If the filterString contains any comparison with multilingual texts, the filterLanguage parameter is used to decide,
  which language of the texts should be compared. All multilingual texts will be returned in the languages specified in the languages parameter.
  All language identifying parameters must be provided in ISO language code format (e.g. "en-US", "de-DE"), and must be valid logging languages.
  The retrieved multilingual texts will be returned as arrays of strings, one element standing for one language specified,
  in the order they were passed. The 'languages' attribute can be selected, that will specify this order again,
  so they are available when processing the query.
  The startTime and endTime parameters are the boundaries for reading the historical alarm entries, only alarms with ModificationTime greater than startTime,
  and less than endTime will be read. The maxNumberOfResults restricts the amount of returned alarm entries.

  Errors:
    0 - Success
    301 - Syntax error in query string
    302 - At least one of the requested languages is invalid (or not logged)
    303 - The provided filter language is invalid (or not logged)
  `,
  {
    systemNames: z.array(z.string()).optional().default([]),
    filterString: z.string().optional().default(""),
    filterLanguage: z.string().optional().default("en-US"),
    languages: z.array(z.string()).optional().default(["en-US"]),
    startTime: z.string().datetime({ message: "Invalid ISO 8601 datetime string for startTime" }).optional().default("1970-01-01T00:00:00.000Z"),
    endTime: z.string().datetime({ message: "Invalid ISO 8601 datetime string for endTime" }).optional().default("1970-01-01T00:00:00.000Z"),
    maxNumberOfResults: z.number().int().optional().default(0),
  },
  async ({ systemNames, filterString, filterLanguage, languages: requestedLanguages, startTime, endTime, maxNumberOfResults }, executionContext) => {
    console.log(`Tool 'get-logged-alarms' called with:`, { systemNames, filterString, filterLanguage, languages: requestedLanguages, startTime, endTime, maxNumberOfResults });

    const graphqlQuery = `
      query GetLoggedAlarms(
        $systemNames: [String],
        $filterString: String,
        $filterLanguage: String,
        $languages: [String],
        $startTime: Timestamp,
        $endTime: Timestamp,
        $maxNumberOfResults: Int
      ) {
        loggedAlarms(
          systemNames: $systemNames,
          filterString: $filterString,
          filterLanguage: $filterLanguage,
          languages: $languages,
          startTime: $startTime,
          endTime: $endTime,
          maxNumberOfResults: $maxNumberOfResults
        ) {
          name
          instanceID
          raiseTime
          acknowledgmentTime
          clearTime
          resetTime
          modificationTime
          state
          priority
          eventText
          infoText
          languages
        }
      }
    `;

    const variables = {
      systemNames,
      filterString,
      filterLanguage,
      languages: requestedLanguages,
      startTime,
      endTime,
      maxNumberOfResults,
    };

    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) { // Still using global sessionData
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({ query: graphqlQuery, variables }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL loggedAlarms request failed with status ${response.status}: ${errorBody}`);
        throw new Error(`LoggedAlarms request failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();

      if (jsonResponse.errors) {
        console.error('GraphQL loggedAlarms errors:', JSON.stringify(jsonResponse.errors, null, 2));
        throw new Error(`LoggedAlarms query errors: ${jsonResponse.errors.map(e => e.message).join(", ")}`);
      }

      console.log('Successfully fetched loggedAlarms from GraphQL server. Number of alarms: ', jsonResponse.data?.loggedAlarms?.length || 0);
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data?.loggedAlarms || [], null, 2) }] };
    } catch (error) {
      console.error("Error in 'get-logged-alarms' tool during GraphQL call:", error);
      throw new Error(`Failed to retrieve logged alarms: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to write tag values to WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "write-tag-values",
  `Updates tags, based on the provided TagValueInput list.
  If a TagValueInput does not define a specific timestamp, the optional timestamp parameter will be used as a fallback. If the optional timestamp parameter is not set, the current time will be used instead. Sample timestamp: '2022-04-27T01:30:32.506Z'
  If a TagValueInput does not define a specific quality, the optional quality parameter will be used as a fallback. If the optional quality parameter is not set, GOOD quality will be assumed.

  Errors:
    0 - Success
    2 - Cannot resolve provided name
    201 - Cannot convert provided value to data type
    202 - Only leaf elements of a Structure Tag can be addressed
  `,
  {
    input: z.array(z.object({
      name: z.string().min(1, "Tag name cannot be empty."),
      value: z.any(), // GraphQL Variant can be string, number, boolean, etc.
      timestamp: z.string().datetime({ message: "Invalid ISO 8601 datetime string for timestamp" }).optional(),
      quality: QualityInputZod.optional(),
    })).min(1, "At least one tag value input must be provided."),
    timestamp: z.string().datetime({ message: "Invalid ISO 8601 datetime string for global timestamp" }).optional(),
    quality: QualityInputZod.optional(),
  },
  async ({ input, timestamp, quality }, executionContext) => {
    console.log(`Tool 'write-tag-values' called with:`, { input, timestamp, quality });

    const graphqlMutation = `
      mutation WriteTagValues(
        $input: [TagValueInput]!,
        $timestamp: Timestamp,
        $quality: QualityInput
      ) {
        writeTagValues(
          input: $input,
          timestamp: $timestamp,
          quality: $quality
        ) {
          name
          error {
            code
            description
          }
        }
      }
    `;

    const variables = {
      input,
      timestamp,
      quality,
    };

    try {
      console.log(`[write-tag-values] Attempting to send mutation to: ${WINCC_UNIFIED_GRAPHQL_URL}`);
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) { // Still using global sessionData
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({ query: graphqlMutation, variables }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL writeTagValues mutation failed with status ${response.status}: ${errorBody}`);
        throw new Error(`WriteTagValues mutation failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();
      // Note: Mutations might return errors within jsonResponse.data.writeTagValues for individual items,
      // or top-level jsonResponse.errors for general mutation failures.
      // The current return forwards the whole result including per-item errors.
      console.log('Successfully sent writeTagValues mutation to GraphQL server.');
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data?.writeTagValues || jsonResponse.errors || { error: "Unknown error" }, null, 2) }] };
    } catch (error) {
      console.error("Error in 'write-tag-values' tool during GraphQL call:", error);
      throw new Error(`Failed to write tag values: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to acknowledge or reset alarms in WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "acknowledge-alarms",
  `Acknowledge one or more alarms.
  Each alarm identifier must have the name of the configured alarm, and optionally an instanceID, which identifies
  one active instance of the configured alarm. If the instanceID is 0 or not provided, all instances of the given alarm will be acknowledged.
  If an alarm requires single acknowledgement, only one item can be provided at a time, otherwise the request will be rejected.

  Errors:
    0 - Success
    2 - Cannot resolve provided name
    304 - Invalid object state
    305 - The alarm cannot be read / acknowledged / reset in current state
    x - Alarm instance does not exist (where x is the instanceID or an indicator for the alarm name if no instanceID was provided)
  `,
  {
    input: z.array(AlarmIdentifierInputZod).min(1, "At least one alarm identifier must be provided."),
  },
  async ({ input }, executionContext) => {
    console.log(`Tool 'acknowledge-alarms' called with:`, { input });

    const graphqlMutation = `
      mutation AcknowledgeAlarms($input: [AlarmIdentifierInput]!) {
        acknowledgeAlarms(input: $input) {
          alarmName
          alarmInstanceID
          error {
            code
            description
          }
        }
      }
    `;

    const variables = {
      input,
    };

    try {
      console.log(`[acknowledge-alarms] Attempting to send mutation to: ${WINCC_UNIFIED_GRAPHQL_URL}`);
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) { // Still using global sessionData
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({ query: graphqlMutation, variables }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL acknowledgeAlarms mutation failed with status ${response.status}: ${errorBody}`);
        throw new Error(`AcknowledgeAlarms mutation failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();
      console.log('Successfully sent acknowledgeAlarms mutation to GraphQL server.');
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data?.acknowledgeAlarms || jsonResponse.errors || { error: "Unknown error" }, null, 2) }] };
    } catch (error) {
      console.error("Error in 'acknowledge-alarms' tool during GraphQL call:", error);
      throw new Error(`Failed to acknowledge alarms: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Tool to reset alarms in WinCC Unified
// ------------------------------------------------------------------------------------------------------------------------------------------------

server.tool(
  "reset-alarms",
  `Reset one or more alarms.
  Each alarm identifier must have the name of the configured alarm, and optionally an instanceID, which identifies
  one active instance of the configured alarm. If the instanceID is 0 or not provided, all instances of the given alarm will be reset.
  If an alarm requires single reset, only one item can be provided at a time, otherwise the request will be rejected.

  Errors:
    0 - Success
    2 - Cannot resolve provided name
    304 - Invalid object state
    305 - The alarm cannot be read / acknowledged / reset in current state
    x - Alarm instance does not exist (where x is the instanceID or an indicator for the alarm name if no instanceID was provided)
  `,
  {
    input: z.array(AlarmIdentifierInputZod).min(1, "At least one alarm identifier must be provided."),
  },
  async ({ input }, executionContext) => {
    console.log(`Tool 'reset-alarms' called with:`, { input });

    const graphqlMutation = `
      mutation ResetAlarms($input: [AlarmIdentifierInput]!) {
        resetAlarms(input: $input) {
          alarmName
          alarmInstanceID
          error {
            code
            description
          }
        }
      }
    `;

    const variables = {
      input,
    };

    try {
      console.log(`[reset-alarms] Attempting to send mutation to: ${WINCC_UNIFIED_GRAPHQL_URL}`);
      const headers = {
        'Content-Type': 'application/json',
      };
      if (sessionData?.apiToken) { // Still using global sessionData
        headers['Authorization'] = `Bearer ${sessionData.apiToken}`;
      }

      const response = await fetch(WINCC_UNIFIED_GRAPHQL_URL, {
        method: 'POST',
        headers: headers,
        agent: agentToUse,
        body: JSON.stringify({ query: graphqlMutation, variables }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`GraphQL resetAlarms mutation failed with status ${response.status}: ${errorBody}`);
        throw new Error(`ResetAlarms mutation failed: ${response.status} - ${response.statusText}`);
      }

      const jsonResponse = await response.json();
      console.log('Successfully sent resetAlarms mutation to GraphQL server.');
      return { content: [{ type: "text", text: JSON.stringify(jsonResponse.data?.resetAlarms || jsonResponse.errors || { error: "Unknown error" }, null, 2) }] };
    } catch (error) {
      console.error("Error in 'reset-alarms' tool during GraphQL call:", error);
      throw new Error(`Failed to reset alarms: ${error.message}`);
    }
  }
);

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Express server setup for MCP requests
// ------------------------------------------------------------------------------------------------------------------------------------------------

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  console.log('Received POST MCP request');
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      transport.close();
      // server.close(); // DO NOT close the main server instance on each request
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

app.delete('/mcp', async (req, res) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

// Start the server
const PORT = process.env.MCP_PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP Extended WinCC OA Server listening on port ${PORT}`);
  console.log(`Server ready with WinCC Unified tools available`);
});