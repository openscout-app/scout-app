"""Host-local compiler queue using the kernel advisory lock (macOS and Linux).

Requires Python 3, already used by repository tooling. Never unlink this file:
waiters must all lock the same inode. Empty files and crashed owners are normal.
"""
import fcntl
import subprocess
import sys

with open(sys.argv[1], "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    # Inherit the locked fd too: if this supervisor is killed, the compiler
    # keeps the lock until it exits. No stale-owner detection or reclaim race.
    result = subprocess.run(sys.argv[2:], pass_fds=(lock.fileno(),))
    sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
