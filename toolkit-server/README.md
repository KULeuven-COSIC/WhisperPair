# toolkit-server

Implementation of the toolkit server.
Automatically discovers Fast Pair devices and allows clients to test attacks on them.  
To interact with the server, use the [`toolkit-ui`](../toolkit-ui/).

> [!NOTE]
> If you are looking for the implementation of the attacks specifically, they are located in [`./src/fast-pair-service.ts`](./src/fast-pair-service.ts) and [`./src/protocol.ts`](./src/protocol.ts).

## Prerequisites

> [!NOTE]
> **Environment:** Only Linux is supported. We tested the server on a Raspberry Pi 4 using Raspberry Pi OS Lite (64-bit) (6.12.47+rpt-rpi-v8) and BlueZ version `5.82`. However, it should work on any Linux system with a compatible `bluez` stack.

1. Install Node.js (tested with LTS v24.14.0) ([https://nodejs.org/en/download](https://nodejs.org/en/download)).

2. Install `pnpm` ([https://pnpm.io/installation](https://pnpm.io/installation)).  
   If Node.js is installed:

```bash
corepack enable
```

3. `bluez` and `bluez-utils` may need to be installed

```bash
sudo apt install bluez bluez-utils
```

> [!NOTE]
> **Legacy Tools:** The harness also requires `hcitool` and `l2ping`. Depending on your Linux distribution, `hcitool` might not be available. You might have to install `bluez-deprecated-tools`. It remains preinstalled on the latest Raspberry Pi OS Lite version at the time of writing. (1 Oct 2025)

4. Ensure Bluetooth is enabled:

```bash
sudo rfkill unblock bluetooth
```

## Setup

### Automated (Recommended)

Run the provided `build.sh` script to install dependencies and compile the server:

```bash
bash build.sh
```

### Manual

If you prefer to set up the server manually, run the following commands:

1. Install the dependencies

```bash
pnpm install
```

2. Build the server

```bash
pnpm build
```

## Usage

Start the server:

```bash
bash start.sh
```
