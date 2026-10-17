# Anki

Subaudi bundles the official Anki Python/Rust backend, version 26.9.3.
Copyright: Ankitects Pty Ltd and contributors.
License: GNU Affero General Public License, version 3 or later.

Build revision: 29bb700b (from anki/buildinfo.py; internal version 26.09.3).
Source: https://github.com/ankitects/anki/tree/29bb700b
License: https://github.com/ankitects/anki/blob/29bb700b/LICENSE
Package: https://pypi.org/project/anki/26.9.3/

The upstream backend is unmodified. The Subaudi adapter and build instructions
are in services/anki/, scripts/build-anki.py and docs/ANKI.md. Dependency versions
are recorded in services/anki/requirements.lock.txt. Distribution of a combined
product must meet applicable AGPL corresponding-source requirements; separating
the backend into a process is not a license exception.

The 26.9.3 package version is verified from installed wheel metadata. The upstream
build revision is verified from the package's buildinfo.py. The corresponding
repository snapshot is included as anki-source-29bb700b.tar.gz.
