# macOS launchd Service

Run the gateway as a per-user or system LaunchDaemon on macOS.

## Per-user agent

```bash
mkdir -p ~/Library/LaunchAgents
cp deployment/launchd/com.siddhartha-kumar.claude-universal-custom-proxy.plist \
   ~/Library/LaunchAgents/

launchctl load ~/Library/LaunchAgents/com.siddhartha-kumar.claude-universal-custom-proxy.plist
launchctl start com.siddhartha-kumar.claude-universal-custom-proxy
```

## System daemon

```bash
sudo mkdir -p /usr/local/opt/claude-universal-custom-proxy
sudo mkdir -p /usr/local/var/log/claude-universal-custom-proxy

sudo cp deployment/launchd/com.siddhartha-kumar.claude-universal-custom-proxy.plist \
   /Library/LaunchDaemons/

sudo chown root:wheel /Library/LaunchDaemons/com.siddhartha-kumar.claude-universal-custom-proxy.plist
sudo chmod 644 /Library/LaunchDaemons/com.siddhartha-kumar.claude-universal-custom-proxy.plist

sudo launchctl load /Library/LaunchDaemons/com.siddhartha-kumar.claude-universal-custom-proxy.plist
```

## Inspection

```bash
launchctl list | grep claude-universal-custom-proxy
tail -F /usr/local/var/log/claude-universal-custom-proxy/stdout.log
```

## Stop and unload

```bash
launchctl unload ~/Library/LaunchAgents/com.siddhartha-kumar.claude-universal-custom-proxy.plist
```

## Environment

Set `GATEWAY_API_KEYS`, provider tokens, and other gateway variables in the
`EnvironmentVariables` dict before loading, or use a wrapper shell script
that loads from a protected `.env` file and is invoked from `ProgramArguments`.
