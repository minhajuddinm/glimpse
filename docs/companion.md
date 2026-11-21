# Companion page

The companion page shows the live transcript and answers in a browser on another device: a phone, a tablet or a second computer.

It's useful when:
- **You view your PC through Moonlight, Parsec or Remote Desktop.** The overlay is hidden from capture, so you can't see it through those tools. The companion page shows the same answers.
- **You'd rather glance at a phone** than at the side of your screen.

## Turn it on

1. Go to **Settings → Companion** and switch **Turn on**.
2. By default only this PC can open the page. To use your phone, also switch **Allow other devices**. The phone must be on the same Wi-Fi, or on the same [Tailscale](https://tailscale.com) network.
3. Scan the **QR code** with your phone, or type the address shown.

Windows may ask whether to let Glimpse through the firewall. Allow **Private networks** only.

## Security

- The page is served **from your PC only**. It never goes through the internet or a Glimpse server.
- Every link carries a random **access code**. Treat the link like a password.
- **New access code** makes all old links stop working.
- Turn **Allow other devices** off when you're on public Wi-Fi.
