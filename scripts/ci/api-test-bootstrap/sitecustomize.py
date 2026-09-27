"""Preload a large third-party parser before pytest-cov starts in every worker.

``probablepeople`` imports a generated 154,000-line ratios module. With Python
3.12 branch coverage active, that third-party import takes minutes per xdist
worker even though Atlas is the only coverage source. The API test command alone
adds this directory to PYTHONPATH, so normal application startup is unaffected.
"""

import probablepeople  # noqa: F401
