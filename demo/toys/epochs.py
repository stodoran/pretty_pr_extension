"""Toy epoch counter (demo fixture). The PR only rewrites one docstring here."""


class EpochCounter:
    def __init__(self, total: int):
        self.total = total
        self._done = 0

    def set_epoch(self, epoch: int) -> None:
        """Advance the counter up to and including ``epoch``. An earlier epoch is ignored: on a resume,
        the data loader calls ``set_epoch(0)`` after the trainer has already set the epoch to continue from."""
        if epoch < self._done:
            return
        self._done = min(epoch + 1, self.total)

    def remaining(self) -> int:
        return self.total - self._done
