#!/bin/sh
# Sets up the host where Pangolin (Traefik) keeps a wildcard certificate, so that
# Wayfinderr can fetch it over SSH for its built-in HTTPS and follow its renewals
# (docs/DEPLOYMENT.md, "Wildcard from Pangolin"; issue #98).
#
# Run it once, as root, on that host, with the public key the Wayfinderr backend logs
# at start ("HTTPS certificate from …"):
#
#   sudo sh pangolin-cert-setup.sh 'ecdsa-sha2-nistp256 AAAA… wayfinderr-https'
#
# It finds Traefik's acme.json and the wildcard in it by itself (or pass --acme-json
# and --domain), and then:
#   - writes /usr/local/bin/wayfinderr-cert, which prints that certificate and its key
#     only (never the other certificates, nor the ACME account);
#   - creates the user wayfinderr-cert, whose SSH key may run that command only
#     (authorized_keys: restrict,command=…), through sudo since acme.json is root's;
#   - checks that it works, and prints the host key fingerprints to compare with
#     the one Wayfinderr logs at its first connection.
# Run it again to change the key, the file or the domain: it replaces its own files.
#
# Options: --acme-json <path>  --domain '*.example.com'  --user <name>
#          --dry-run   find and check everything, change nothing (no key needed)

set -eu

USER_NAME=wayfinderr-cert
COMMAND=/usr/local/bin/wayfinderr-cert
SUDOERS=/etc/sudoers.d/wayfinderr-cert
KEY=""
ACME=""
DOMAIN=""
DRY_RUN=false

die() {
  echo "pangolin-cert-setup: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --acme-json) [ $# -ge 2 ] || die "--acme-json needs a path"; ACME=$2; shift 2 ;;
    --domain) [ $# -ge 2 ] || die "--domain needs a name like '*.example.com'"; DOMAIN=$2; shift 2 ;;
    --user) [ $# -ge 2 ] || die "--user needs a name"; USER_NAME=$2; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$KEY" ] || die "one public key only (put it in single quotes)"; KEY=$1; shift ;;
  esac
done

[ "$(id -u)" = 0 ] || [ "$DRY_RUN" = true ] || die "run it as root: sudo sh $0 '<public key>'"
[ -n "$KEY" ] || [ "$DRY_RUN" = true ] || die "the public key is missing: copy it from the Wayfinderr backend log (docker compose logs wayfinderr-backend | grep 'HTTPS certificate from')"
case "$KEY" in
  '' | ecdsa-sha2-nistp256\ * | ssh-ed25519\ * | ssh-rsa\ *) ;;
  *) die "this is not an SSH public key: $KEY" ;;
esac
case "$KEY$ACME$DOMAIN$USER_NAME" in
  *\'* | *\"* | *\\*) die "quotes and backslashes are not allowed in the key, the path, the domain or the user" ;;
esac
printf '%s' "$USER_NAME" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$' || die "not a user name: $USER_NAME"

command -v sudo >/dev/null 2>&1 || [ "$DRY_RUN" = true ] || die "sudo is needed (apt install sudo): acme.json can be read by root only"
if [ -n "${PANGOLIN_CERT_TOOL:-}" ]; then
  TOOL=$PANGOLIN_CERT_TOOL # jq or python3: to try the other one (tests)
elif command -v jq >/dev/null 2>&1; then
  TOOL=jq
elif command -v python3 >/dev/null 2>&1; then
  TOOL=python3
else
  die "jq or python3 is needed to read acme.json (apt install jq)"
fi

# --- acme.json ---
if [ -z "$ACME" ]; then
  found=$(find /root /opt /srv /home /var/lib /etc /usr/local -maxdepth 7 -type f -name acme.json 2>/dev/null || true)
  count=$(printf '%s\n' "$found" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    die "no acme.json found: pass its path with --acme-json (in Pangolin's folder, config/letsencrypt/acme.json)"
  elif [ "$count" -gt 1 ]; then
    die "more than one acme.json: pass one with --acme-json:
$found"
  fi
  ACME=$found
fi
[ -f "$ACME" ] && [ -r "$ACME" ] || die "cannot read $ACME"
ACME=$(cd "$(dirname "$ACME")" && pwd)/$(basename "$ACME")

# --- the wildcard ---
wildcards() {
  if [ "$TOOL" = jq ]; then
    jq -r '[.[]? | objects | .Certificates[]? | [.domain.main] + (.domain.sans // []) | .[]]
      | map(select(type == "string" and startswith("*."))) | unique | .[]' "$ACME"
  else
    python3 - "$ACME" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
names = set()
for resolver in data.values():
    if not isinstance(resolver, dict):
        continue
    for cert in resolver.get("Certificates") or []:
        domain = cert.get("domain") or {}
        for name in [domain.get("main")] + (domain.get("sans") or []):
            if isinstance(name, str) and name.startswith("*."):
                names.add(name)
print("\n".join(sorted(names)))
PY
  fi
}
all=$(wildcards) || die "$ACME is not Traefik's acme.json (not JSON?)"
if [ -z "$DOMAIN" ]; then
  count=$(printf '%s\n' "$all" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    die "no wildcard certificate in $ACME: pass the name with --domain (Pangolin asks for wildcards with a DNS challenge)"
  elif [ "$count" -gt 1 ]; then
    die "more than one wildcard in $ACME: pass one with --domain:
$all"
  fi
  DOMAIN=$all
else
  printf '%s\n' "$all" | grep -qxF "$DOMAIN" || echo "pangolin-cert-setup: warning: $DOMAIN is not a wildcard in $ACME now; set up anyway" >&2
fi

# --- the command: prints that certificate and its key only ---
if [ "$DRY_RUN" = true ]; then tmp=$(mktemp); else tmp="$COMMAND.$$"; fi
if [ "$TOOL" = jq ]; then
  cat >"$tmp" <<EOF
#!/bin/sh
# Prints the certificate $DOMAIN and its key from Traefik's acme.json, for Wayfinderr's
# built-in HTTPS. Written by pangolin-cert-setup.sh: run that again to change it.
exec jq -c --arg d '$DOMAIN' '[.[]? | objects | .Certificates[]? | select(([.domain.main] + (.domain.sans // [])) | index(\$d))] | first // error("no certificate for " + \$d) | {certificate, key}' '$ACME'
EOF
else
  cat >"$tmp" <<EOF
#!/bin/sh
# Prints the certificate $DOMAIN and its key from Traefik's acme.json, for Wayfinderr's
# built-in HTTPS. Written by pangolin-cert-setup.sh: run that again to change it.
exec python3 - '$ACME' '$DOMAIN' <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for resolver in data.values():
    if not isinstance(resolver, dict):
        continue
    for cert in resolver.get("Certificates") or []:
        domain = cert.get("domain") or {}
        if sys.argv[2] in [domain.get("main")] + (domain.get("sans") or []):
            print(json.dumps({"certificate": cert.get("certificate"), "key": cert.get("key")}, separators=(",", ":")))
            sys.exit(0)
sys.exit("no certificate for " + sys.argv[2])
PY
EOF
fi
chmod 755 "$tmp"

if [ "$DRY_RUN" = true ]; then
  out=$(sh "$tmp" 2>&1) || { rm -f "$tmp"; die "the command would fail: $out"; }
  rm -f "$tmp"
  case "$out" in
    *'"certificate":"'*'"key":"'*) ;;
    *) die "the command would not print the certificate (it printed ${#out} characters, not shown: they may hold a key)" ;;
  esac
  out=""
  echo "Dry run, nothing changed. It would set up:"
  echo "  $COMMAND: prints $DOMAIN and its key from $ACME (read with $TOOL): checked, it works"
  echo "  user $USER_NAME, allowed by $SUDOERS to run that command only"
  echo "  its authorized_keys: restrict,command=\"sudo -n $COMMAND\" ${KEY:-<the key from the Wayfinderr log>}"
  exit 0
fi
chown root:root "$tmp"
mv "$tmp" "$COMMAND"

# --- the user ---
if ! id "$USER_NAME" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/var/lib/$USER_NAME" --shell /bin/sh "$USER_NAME"
  else
    adduser -S -D -h "/var/lib/$USER_NAME" -s /bin/sh "$USER_NAME"
  fi
fi
# No password, but not locked: OpenSSH refuses even a key to a locked account
if command -v usermod >/dev/null 2>&1; then usermod -p '*' "$USER_NAME"; fi
HOME_DIR=$(awk -F: -v u="$USER_NAME" '$1 == u { print $6 }' /etc/passwd)
[ -n "$HOME_DIR" ] || die "cannot find the home of $USER_NAME"
GROUP=$(id -gn "$USER_NAME")

# --- sudo: that command, nothing else ---
tmp="$SUDOERS.$$"
printf '# Wayfinderr fetches one certificate (pangolin-cert-setup.sh)\nDefaults:%s !requiretty\n%s ALL=(root) NOPASSWD: %s\n' \
  "$USER_NAME" "$USER_NAME" "$COMMAND" >"$tmp"
chmod 440 "$tmp"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "sudoers rule refused by visudo"; }
fi
mv "$tmp" "$SUDOERS"

# --- SSH: the key may run that command only ---
mkdir -p "$HOME_DIR/.ssh"
printf 'restrict,command="sudo -n %s" %s\n' "$COMMAND" "$KEY" >"$HOME_DIR/.ssh/authorized_keys"
chown -R "$USER_NAME:$GROUP" "$HOME_DIR/.ssh"
chmod 700 "$HOME_DIR/.ssh"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

# --- check, without printing the key ---
out=$(su -s /bin/sh "$USER_NAME" -c "sudo -n $COMMAND" 2>&1) || die "the command fails as $USER_NAME: $out"
case "$out" in
  *'"certificate":"'*'"key":"'*) ;;
  *) die "the command does not print the certificate (it printed ${#out} characters, not shown: they may hold a key)" ;;
esac
out=""

if command -v sshd >/dev/null 2>&1; then
  sshd -T 2>/dev/null | grep -Eiq '^(allowusers|allowgroups) ' &&
    echo "pangolin-cert-setup: warning: sshd has AllowUsers/AllowGroups: add $USER_NAME there, or SSH refuses it" >&2
fi

echo "Done: $USER_NAME can fetch $DOMAIN from $ACME, and nothing else."
echo "Wayfinderr fetches it within 15 minutes, or now with: docker compose restart wayfinderr-backend"
echo "Host keys of this machine, to compare with the one Wayfinderr logs at its first connection:"
for f in /etc/ssh/ssh_host_*_key.pub; do
  [ -f "$f" ] && ssh-keygen -lf "$f" 2>/dev/null | awk '{ print "  " $2 " (" $NF ")" }'
done
exit 0
