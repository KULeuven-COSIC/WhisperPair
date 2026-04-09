import { exec, spawn } from "node:child_process";
import { XMLParser } from "fast-xml-parser";

/** An RFCOMM socket. */
interface RFCOMMSocket {
  id: string;
  address: string;
  channel: number;
  status: string;
}

/** Gets all the open RFCOMM sockets. */
async function getSockets(): Promise<RFCOMMSocket[]> {
  const rfcommOutput = await new Promise<string>((resolve, reject) => {
    return exec("rfcomm", (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(stdout);
    });
  });

  const regex = /(rfcomm\d+): (.+) channel (\d+) (.+)\n?/gm;
  const matches = rfcommOutput.matchAll(regex);

  return Array.from(matches).map((match) => ({
    id: match[1]!,
    address: match[2]!,
    channel: +match[3]!,
    status: match[4]?.trim()!,
  }));
}

/** Closes an RFCOMM channel. */
async function close(id: string) {
  await new Promise<string>((resolve, reject) => {
    return exec(`rfcomm release /dev/${id}`, (error, stdout, stderr) => {
      if (error) return reject(error);
      if (stderr) return reject(new Error(stderr));
      resolve(stdout);
    });
  });
}

/** Gets an avalable RFCOMM socket id. */
function getAvailableSocketId(sockets: RFCOMMSocket[]) {
  const ids = new Set(sockets.map(({ id }) => +id.slice(6)));

  for (let i = 0; i < 100; i++) {
    if (ids.has(i)) continue;
    return i;
  }

  throw new Error("Could not find an available RFCOMM socket.");
}

/** Opens an RFCOMM socket to an address, given a channel number. */
export async function open(address: string, channel: number) {
  let sockets = await getSockets();

  const existingSocket = sockets.find(
    (socket) => socket.address == address && socket.channel == channel,
  );

  if (existingSocket) {
    await close(existingSocket.id);
    sockets = await getSockets();
  }

  // open a new socket
  const availableSocketId = getAvailableSocketId(sockets);

  await new Promise<void>((resolve, reject) => {
    exec(
      `rfcomm bind /dev/rfcomm${availableSocketId} ${address} ${channel}`,
      (error, _, stderr) => {
        if (error) return reject(error);
        if (stderr) return reject(new Error(stderr));
        resolve();
      },
    );
  });

  return `rfcomm${availableSocketId}`;
}

/** Attempts to find a Fast Pair RFCOMM channel. */
export function findFastPairRFCOMMChannel(address: string) {
  return new Promise<number>((resolve, reject) => {
    const parser = new XMLParser({
      ignoreAttributes: false,
    });
    const sdptool = spawn("stdbuf", ["-oL", `sdptool`, `records`, `--xml`, address]);
    let buffer: string = "";

    function onRecord(record: string) {
      const obj = parser.parse(record);

      const attribute = obj.record.attribute;

      const uuid = attribute.find((attribute: any) => attribute["@_id"] == "0x0001").sequence.uuid[
        "@_value"
      ];

      if (uuid === "df21fe2c-2515-4fdb-8886-f12c4d67927c") {
        // is fast pair record
        const protocolDescriptorList = attribute.find(
          (attribute: any) => attribute["@_id"] == "0x0004",
        );
        const rfcommRecord = protocolDescriptorList.sequence.sequence.find(
          (attribute: any) => attribute.uuid["@_value"] == "0x0003",
        ).uint8["@_value"];
        const channel = Number(rfcommRecord);

        sdptool.stdout.off("data", onData);
        sdptool.kill();

        resolve(channel);
      }
    }

    function onData(chunk: Buffer) {
      const string = chunk.toString();
      buffer += string;

      for (let i = buffer.indexOf("</record>"); i != -1; i = buffer.indexOf("</record>")) {
        const record = buffer.slice(0, i + 9);
        buffer = buffer.slice(i + 9);
        onRecord(record);
      }
    }

    sdptool.stdout.on("data", onData);
    sdptool.on("exit", () => reject(new Error("Did not find RFCOMM channel in sdptool output.")));
  });
}

const rfcomm = {
  findFastPairRFCOMMChannel,
  open,
};

export default rfcomm;
