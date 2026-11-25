"""Assemble installable public source snapshots until the three matching npm releases exist."""
from pathlib import Path
import gzip,hashlib,io,json,subprocess,sys,tarfile
REV='9f568e24779b44d6f0f545322486b6011f28d21c' # v0.5.4
SHA='918613070cd2d86c8b81d654011948c77364bb6fb52a806195987418931b8a65'

# Neutralize machine-specific examples in the pinned upstream source. Keep
# platform path handling, package versions, licenses, and exports unchanged.
EXAMPLES = {
    'pairing': {
        'src/core/pairing/runtime/bridge/server.ts': {
            542: "        // Reconstruct CWD from Claude Code's path encoding: -Users-foo-dev-bar → the user home followed by dev/bar",
            1327: '  // Claude Code pattern: ~/.claude/projects/-Users-demo-dev-PROJECT/...',
        },
        'src/models/screens/agents/agents-feed-article.ts': {
            137: '/** a macOS home path → `~/…` for display only. */',
        },
    },
    'runtime': {
        'src/broker-session-wake.ts': {
            469: ' * address rules (derived label, node id, name, host name), so `build-host`,',
            470: ' * `build-host.local` and the full node id all land on the same machine. A name',
            559: ' * path, so `/example/operator/dev/x` goes to the machine whose agents live under',
            560: ' * `/example/operator` before any other peer is asked.',
        },
        'src/broker-web-control-service.ts': {
            653: '      throw new Error("The web app is distributed separately from Scout core. Install the app and configure OPENSCOUT_WEB_SERVER_ENTRY.");',
        },
        'src/continuation/grants.ts': {
            16: ' *       { "scope": "project", "path": "/example/operator/dev/app", "level": "workspace" },',
        },
        'src/local-edge-trust.ts': {
            9: '// voice work on a named host like dev-host.scout.local.',
        },
        'src/project-name.ts': {
            8: ' * A session that starts with no cwd boots in `$HOME`, and `basename("/example/operator")`',
        },
        'src/session-locator.ts': {
            188: '    // e.g. -Users-demo-dev-sample → the demo home followed by dev/sample (best-effort)',
        },
        'src/settings-catalog.ts': {
            21: ' * - `shared-app`: the Scout clients read it and share it between devices.',
        },
        'src/system-probes/lan-scan.ts': {
            238: '/** `Build\\032Host` → `Build Host`. dns-sd escapes with decimal byte codes. */',
            274: '      // `0 0 7000 dev-host.local. ; Replace with unicast FQDN…`',
        },
        'src/tail/claude-source.ts': {
            67: '  // Example: a macOS home path ending in dev/sample → -Users-demo-dev-sample',
        },
        'src/tail/pi-source.ts': {
            142: '/** Pi encodes cwd as `--Users-demo-dev-sample--` under ~/.pi/agent/sessions/. */',
        },
        'src/tail/tool-format.ts': {
            5: '// is unreadable noise: `Read({"file_path":"/repo/scout-tail.tsx"})` or a',
        },
        'src/web-full-client.ts': {
            1: '// The Scout clients supply the web server and client. The core can resolve an',
        },
    },
}

def sanitize_examples(name, files):
    for path, replacements in EXAMPLES.get(name, {}).items():
        # The upstream archive digest pins these line numbers. Re-audit the
        # patches whenever the source revision changes.
        lines = files[path].splitlines(keepends=True)
        for line, example in replacements.items():
            lines[line - 1] = (example + '\n').encode()
        files[path] = b''.join(lines)

def write_package(path, files):
    with path.open('wb') as f,gzip.GzipFile(fileobj=f,filename='',mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as dest:
        for k,data in sorted(files.items()):
            info=tarfile.TarInfo('package/'+k);info.size=len(data);dest.addfile(info,io.BytesIO(data))

def main():
    archive=Path(sys.argv[1]).read_bytes() if len(sys.argv)>1 else subprocess.check_output(['curl','-fsSL',f'https://codeload.github.com/openscout-app/scout/tar.gz/{REV}'])
    if hashlib.sha256(archive).hexdigest()!=SHA: raise ValueError("unexpected core source digest")
    src=tarfile.open(fileobj=io.BytesIO(archive)); root='scout-'+REV+'/'
    out=Path(__file__).resolve().parents[1]/'vendor';out.mkdir(exist_ok=True)
    for name in ('agent-sessions','runtime','pairing'):
        prefix=root+'packages/'+name+'/'
        files={p.name[len(prefix):]:src.extractfile(p).read() for p in src if p.isfile() and p.name.startswith(prefix) and (p.name[len(prefix):].startswith(('src/','drizzle/','bin/')) or p.name[len(prefix):] in ('package.json','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md')) and '.test.' not in p.name}
        files.setdefault('LICENSE',src.extractfile(root+'LICENSE').read())
        pkg=json.loads(files['package.json']); pkg.pop('scripts',None);pkg.pop('devDependencies',None)
        # Resolve public-core cross references to the exact versions (root overrides pin the two missing registry names).
        pkg['dependencies']={k:('0.5.4' if v=='workspace:*' else v) for k,v in pkg['dependencies'].items()}
        for k,v in pkg['exports'].items():
            if isinstance(v,dict) and 'bun' in v: pkg['exports'][k]=v['bun']
        files['package.json']=(json.dumps(pkg,indent=2)+'\n').encode()
        sanitize_examples(name, files)
        suffix = '-public' if name in EXAMPLES else ''
        write_package(out / f'{name}-0.5.4{suffix}.tgz', files)

if __name__ == "__main__":
    main()
