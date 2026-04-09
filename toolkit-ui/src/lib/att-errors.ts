/** Standardised ATT errors. */
const attErrors = [
  ["Invalid Handle", "The attribute handle given was not valid on this server."],
  ["Read Not Permitted", "The attribute cannot be read."],
  ["Write Not Permitted", "The attribute cannot be written."],
  ["Invalid PDU", "The attribute PDU was invalid."],
  [
    "Insufficient Authentication",
    "The attribute requires authentication before it can be read or written.",
  ],
  ["Request Not Supported", "ATT Server does not support the request received from the client."],
  ["Invalid Offset", "Offset specified was past the end of the attribute."],
  [
    "Insufficient Authorization",
    "The attribute requires authorization before it can be read or written.",
  ],
  ["Prepare Queue Full", "Too many prepare writes have been queued."],
  ["Attribute Not Found", "No attribute found within the given attribute handle range."],
  ["Attribute Not Long", "The attribute cannot be read using the ATT_READ_BLOB_REQ PDU."],
  [
    "Encryption Key Size Too Short",
    "The Encryption Key Size used for encrypting this link is too short.",
  ],
  ["Invalid Attribute Value Length", "The attribute value length is invalid for the operation."],
  [
    "Unlikely Error",
    "The attribute request that was requested has encountered an error that was unlikely, and therefore could not be completed as requested.",
  ],
  [
    "Insufficient Encryption",
    "The attribute requires encryption before it can be read or written.",
  ],
  [
    "Unsupported Group Type",
    "The attribute type is not a supported grouping attribute as defined by a higher layer specification.",
  ],
  ["Insufficient Resources", "Insufficient Resources to complete the request."],
  ["Database Out Of Sync", "The server requests the client to rediscover the database."],
  ["Value Not Allowed", "The attribute parameter value was not allowed."],
];

/** Common Bluetooth errors. */
const commonErrors = [
  ["Common BLE Profile Error", "Write Request Rejected"],
  [
    "Common BLE Profile Error",
    "Client Characteristic Configuration Descriptor Improperly Configured",
  ],
  ["Common BLE Profile Error", "Procedure Already in Progress"],
  ["Common BLE Profile Error", "Out of Range"],
];

/**
 * Get the title and description given an ATT error code.
 * @param code The error code.
 * @returns The title and description of the error in an array.
 */
function getAttErrorData(code: number) {
  if (code > 0 && code < 20) return attErrors[code - 1];
  if (code >= 128 && code <= 159)
    return ["Application Error", "Application error code defined by a higher layer specification."];
  if (code >= 252 && code <= 255) return commonErrors[code - 252];

  return ["Common BLE Profile Error", "Reserved for future use."];
}

/**
 * Extract the ATT error information from an error message.
 * @param message The error message containing the ATT error code.
 * @returns Information about the error.
 */
export function extractAttErrorInfo(message: string) {
  const regex = /ATT error: (0x[0-9a-zA-Z]+)/gm;

  const result = [...message.matchAll(regex)];
  if (!result[0]) return undefined;

  const code = Number(result[0][1]);
  const data = getAttErrorData(code);

  return { code, codeStr: result[0][1], title: data[0], description: data[1] };
}
