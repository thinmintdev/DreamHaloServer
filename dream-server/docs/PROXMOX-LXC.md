# Running Dream Server in Proxmox LXC

## The Problem

Docker in LXC containers binds to `127.0.0.1` by default, making services unreachable from other machines on the LAN. This is because the loopback interface is virtualized within the container.

Dream Server services (LLM API, WebUI, Dashboard, extensions) listen on container localhost, but with `127.0.0.1` port mappings, the host only exposes ports on its own loopback — not on bridged network interfaces.

## The Solution

All Docker port mappings use `0.0.0.0` as the bind address:

```yaml
ports:
  - "0.0.0.0:8080:8080"  # Binds to all interfaces (LAN-accessible)
```

This exposes the port on every network interface, including the LXC bridge to the Proxmox host and LAN.

## Security: Use Proxmox Firewall Rules

`0.0.0.0` bindings are safe in LXC because:

1. **LXC isolation**: Containers are isolated by default; you can't break out to the host filesystem or kernel.
2. **Proxmox firewall**: Use `Settings > Firewall` on the container node to restrict inbound traffic by IP/CIDR.

Example firewall rule:
- **Direction**: Inbound
- **Action**: ACCEPT
- **Port**: 8080 (or your service port)
- **Source**: `10.0.1.0/24` (your trusted LAN subnet)

See [Proxmox Firewall Documentation](https://pve.proxmox.com/wiki/Firewall) for detailed setup.

## Deployment

Dream Server automatically uses `0.0.0.0` bindings. No configuration needed — services are accessible on the container's LAN IP immediately after startup.
