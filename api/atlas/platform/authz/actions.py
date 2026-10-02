"""The catalog of things an authenticated caller may be allowed to do."""

from __future__ import annotations

from enum import StrEnum

GENERIC_REFUSAL_DETAIL = "This action requires Atlas staff."
MACHINE_ONLY_DETAIL = "Only a trusted machine credential can do this."
EDITORIAL_REFUSAL_DETAIL = "Editorial review requires Atlas staff."
DISCOUNT_REFUSAL_DETAIL = "Discount review access requires Atlas staff."


class Action(StrEnum):
    """One operation that is granted, refused and audited as a unit.

    Values read ``<namespace>.<area>.<verb>``. The ``instance`` namespace exists
    in every deployment, including self-hosted ones, and covers running an Atlas
    instance: editorial review, discovery schedules and runs. The ``platform``
    namespace is the Atlas-owned commercial side and exists only when the
    deployment is managed by the Rebuilding America Project. The ``machine``
    namespace is held only by trusted machine credentials, such as Cloud
    Scheduler's, and never by a person.
    """

    FLAGS_READ = "instance.flags.read"
    FLAGS_RESOLVE = "instance.flags.resolve"
    REVIEW_QUEUE_READ = "instance.review_queue.read"
    REVIEW_QUEUE_STAGE = "instance.review_queue.stage"
    REVIEW_QUEUE_SCAN = "instance.review_queue.scan"
    REVIEW_QUEUE_DECIDE = "instance.review_queue.decide"
    CLAIMS_REVIEW = "instance.claims.review"
    SCHEDULES_READ = "instance.schedules.read"
    SCHEDULES_WRITE = "instance.schedules.write"
    RUNS_CANCEL = "instance.runs.cancel"
    RUNS_INSPECT = "instance.runs.inspect"
    RUNS_VIEW_ALL = "instance.runs.view_all"
    DISCOUNTS_REVIEW = "platform.discounts.review"
    COSTS_VIEW = "platform.costs.view"
    TRIGGER_SCHEDULED_RUNS = "machine.runs.trigger_scheduled"
    DELIVER_FIREHOSE_OBSERVATIONS = "machine.firehose.deliver"

    @property
    def is_platform(self) -> bool:
        """Return whether the action belongs to the managed-only platform namespace."""
        return self.value.startswith("platform.")

    @property
    def is_machine(self) -> bool:
        """Return whether only a trusted machine credential may perform the action."""
        return self.value.startswith("machine.")

    @property
    def refusal_detail(self) -> str:
        """Return the message shown to a caller who may not perform the action."""
        return _REFUSAL_DETAIL.get(self, GENERIC_REFUSAL_DETAIL)


_REFUSAL_DETAIL: dict[Action, str] = {
    Action.FLAGS_READ: EDITORIAL_REFUSAL_DETAIL,
    Action.FLAGS_RESOLVE: EDITORIAL_REFUSAL_DETAIL,
    Action.REVIEW_QUEUE_READ: EDITORIAL_REFUSAL_DETAIL,
    Action.REVIEW_QUEUE_STAGE: EDITORIAL_REFUSAL_DETAIL,
    Action.REVIEW_QUEUE_SCAN: EDITORIAL_REFUSAL_DETAIL,
    Action.REVIEW_QUEUE_DECIDE: EDITORIAL_REFUSAL_DETAIL,
    Action.DISCOUNTS_REVIEW: DISCOUNT_REFUSAL_DETAIL,
    Action.COSTS_VIEW: DISCOUNT_REFUSAL_DETAIL,
    Action.TRIGGER_SCHEDULED_RUNS: MACHINE_ONLY_DETAIL,
    Action.DELIVER_FIREHOSE_OBSERVATIONS: MACHINE_ONLY_DETAIL,
}
