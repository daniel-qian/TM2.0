"""Avery agent service — the deployable HTTP surface (feat-015).

Wraps the EXISTING advisor engine (`avery/loop.py` think->tool->observe + `avery/redline.py`
red line + `avery/brain.py` pluggable brain) as a FastAPI + SSE service with a live-input path.
The engine is NOT rewritten here — this package only:

  * accepts a manager's typed situation (live input) and shapes it into what the loop eats,
  * streams the loop's think/tool/observe steps over SSE,
  * PROJECTS the loop's native artifact onto the 8-field advice contract and RE-VALIDATES the
    red line over the assembled payload — so the moat holds end-to-end through the API, not only
    inside the loop.

Keep LLM keys server-side. Nothing key-bearing is ever sent toward a frontend surface.
"""
