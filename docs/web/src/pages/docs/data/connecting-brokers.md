---
layout: ../../../layouts/DocsLayout.astro
title: Connecting brokers
---

# Connecting brokers

How to get each broker connected. Cloud brokers just need credentials. Desktop terminals (MT5 and NT8) need a
bridge and a few settings.

## MT5 on Windows

App and MT5 on the same machine. The bridge EA connects to the app.

**In MT5:**

1. **Tools -> Options -> Expert Advisors**
   - Check **Allow algorithmic trading**
   - Check **Allow WebRequest for listed URL**, add `127.0.0.1`
2. Attach the **MT5_Bridge** EA to any chart. Inputs:
   - Host `127.0.0.1`
   - Port `7891`
3. Toolbar -> click **Algo Trading** so it is green.

**In the app:**

4. Add an MT5 account -> **MT5 location: Same machine**, Port `7891`
5. Connect.

## MetaTrader 5

MT5's bridge EA dials the app. MT5 and the app can run on the same Windows machine, or MT5 can run in a VM. The
steps below use a VM (`192.168.122.1` = the host); on one machine use `127.0.0.1` instead.

### In the VM (Windows)

1. MT5 -> **Tools -> Options -> Expert Advisors**
   - Check **Allow algorithmic trading**
   - Check **Allow WebRequest for listed URL**, add `192.168.122.1`
2. Attach the **MT5_Bridge** EA to any chart. Inputs:
   - Host `192.168.122.1`
   - Port `7891`
3. Toolbar -> click **Algo Trading** so it is green (enabled).
   The chart's top-right corner then shows the EA name with a blue dot.

### In the app

4. Add an MT5 account:
   - **MT5 location:** VM / another PC
   - **Port:** `7891`
5. Connect. Data flows.

### If it does not connect

- In the VM, run in PowerShell: `Test-NetConnection 192.168.122.1 -Port 7891`
  - `True` -> the EA setting is the problem: recheck step 1 (the allowlist) and step 3 (Algo Trading green).
  - `False` -> the app is not listening or the VM cannot reach it: make sure the app is connecting, then retry.
- `192.168.122.1` is the host address for a libvirt/QEMU VM. On the host, confirm it with `ip addr show virbr0`
  (use the IP on the `inet` line).
