"""Import slow third-party modules before coverage starts tracing.

Loaded as a pytest plugin from ``addopts`` (``-p tests.support.early_imports``).
pytest imports ``-p`` plugins while it parses its command line, ahead of
pytest-cov's ``pytest_load_initial_conftests`` hook, which is where coverage
starts. Anything this module imports therefore runs untraced.

``probablepeople`` needs it. It ships a generated 154,000-line ``ratios`` module
whose body is one enormous code object. CPython 3.12 looks the current line up
with a linear scan of that object's line table on every traced line event, so
importing it costs about 0.4 seconds untraced and about eight and a half minutes
once any tracer is installed, however narrowly ``source`` is scoped. Every
pytest process that measures coverage pays that: the serial run, the xdist
controller, and each of the workers. Importing it here first leaves it in
``sys.modules`` so the later imports from ``atlas`` cost nothing.

This must stay a plain module with no ``atlas`` imports. Importing application
code here would run it untraced too, and coverage would then miss its
import-time lines.
"""

import probablepeople  # noqa: F401
