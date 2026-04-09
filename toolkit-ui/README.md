# toolkit-ui

This is the frontend UI for the WhisperPair testing harness.
It interacts with the [`toolkit-server`](../toolkit-server/) to test WhisperPair attacks.

> [!NOTE]
> If you are looking for the implementation of the attacks, they are located in the [`toolkit-server`](../toolkit-server/) directory. Specifically, in [`../toolkit-server/src/fast-pair-service.ts`](../toolkit-server/src/fast-pair-service.ts) and [`../toolkit-server/src/protocol.ts`](../toolkit-server/src/protocol.ts).

## Prerequisites

> [!NOTE]
> The UI can be run locally, while the server is deployed remotely on a Linux machine such as a Raspberry Pi.

1. Install Node.js (tested with LTS v24.14.0) ([https://nodejs.org/en/download](https://nodejs.org/en/download)).

2. Install `pnpm` ([https://pnpm.io/installation](https://pnpm.io/installation)).  
   If Node.js is installed:

```bash
corepack enable
```

## Setup

### Automated (Recommended)

Ensure the `.env` file contains the URL of the server.  
If possible, you can update it using `update_server_url.sh`:

```bash
bash update_server_url.sh <YOUR_URL>
```

> [!NOTE]
> If you are running the UI and server on the same host, the default value of `http://localhost:8000` is correct.

Run the provided `build.sh` script to install dependencies and compile the UI:

```bash
bash build.sh
```

### Manual

If you prefer to set up the UI manually, run the following commands:

1. Install the dependencies

```bash
pnpm install
```

2. Add the URI of the server to a `.env` file. Example .env file:

```env
SERVER_URL="http://localhost:8000"
```

3. Build the UI

```bash
pnpm build
```

## Usage

> [!NOTE]
> This section contains the same information as in the [top-level README](../README.md).

Start the UI:

```bash
bash start.sh
```

The UI should now become available at [http://localhost:3000](http://localhost:3000).  
If port `3000` is not available, an alternative port will be selected and shown in the output.

The UI will attempt to connect to the server on startup.  
When the connection is successful, a "Connected to the server" message will be displayed in the bottom right corner of the screen.

Evaluating whether a device is vulnerable requires three steps: discovering the device, settings its Model ID, and running an attack.

### 1. Discovering devices

The harness continuously scans for Bluetooth Low Energy devices, which are displayed on the left-hand side of the screen.
Devices advertising Fast Pair data are shown on top.
Device details are shown on the right-hand side of the screen after clicking "Select" on a device.

### 2. Setting a Model ID

Running the tests described in the paper requires a Model ID to be set for a device.
If the device exposes the Fast Pair GATT characteristic, a "Read Model ID" button will be shown in the device details.
Clicking this button will attempt to read the Model ID.

Note that many devices do not correctly implement this characteristic, returning invalid Model IDs.
Alternatively, you can manually set the device's Model ID by pressing the "Set Model ID" button and entering a value manually.
Devices that were evaluated during our tests can be selected, or a custom value can be entered.
A complete list of Fast Pair compatible devices is included in the root of this repository.

Once a Model ID has been set, metadata about the device will be shown in the device details.

### 3. Running an attack

To run an attack, click the "Attack" button in the device details pane.
There are three implemented attacks: pairing state predicate enforcement, nonce reuse, and an invalid curve attack.
If you are already connected to a device, checking the "Reconnect" box will disconnect and reconnect to the device before performing the attack.

The pairing state predicate enforcement check offers some additional configuration options:

- **Switch back**: Attempts to switch back to the original host using the Audio Switch functionality, if supported.
- **Bond**: Performs a BR/EDR pairing if the pairing state predicate is not enforced.
- **Write account key**: Writes a (hardcoded) account key after the pairing procedure.

While an attack is in progress, logs will be shown in real-time in the UI.
After the attack has been completed, its duration will be displayed.

#### Task management

Sometimes, an attack or pairing may take longer than expected.  
You can cancel an attack or pairing by clicking the "Cancel" button in the corresponding dialog.
If you reloaded the UI during an attack or pairing, you can use the task manager to cancel instead.

In the top right-hand side of the screen, the second button from the right will display the task status.
If no tasks are active, it will display "No active tasks".
Otherwise, it will say "Task in progress".
To cancel a task, click the "Task in progress" button, then press the "Cancel" button.

If the server hangs due to a pending task that can't be cancelled, try [resetting the Bluetooth adapter](#troubleshooting).

> [!NOTE]
> Tasks may take up to 20 seconds to cancel.

#### Troubleshooting

In some cases, the Bluetooth adapter may get "stuck" in a "bad state".
The easiest solution to this problem is resetting the Bluetooth adapter.
To perform a reset, open the troubleshooting menu by pressing the wrench icon on the top right-hand side of the screen.
Then, select "Reset BLE adapter" and confirm the reset by clicking "Reset" in the dialog.

If a fatal error occurs and the server has to shut down, the `start.sh` scripts will automatically restart the server.

In scenarios with a lot of nearby BLE devices, the server may unexpectedly close due to a D-Bus error.
This happens very rarely, and the `./start.sh` script should automatically restart the server if this happens.
