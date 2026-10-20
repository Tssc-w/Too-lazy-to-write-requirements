"""Bounded request work and local admission control. Contains no credentials."""
import contextvars
import hashlib
import socket
import threading
import time
from collections import OrderedDict, deque

deadline = contextvars.ContextVar('request_deadline', default=None)


class RequestError(ValueError):
    def __init__(self, message, status=400, code='INVALID_REQUEST'):
        super().__init__(message)
        self.status = status
        self.code = code


def remaining(maximum=75):
    end = deadline.get()
    budget = maximum if end is None else min(maximum, end - time.monotonic())
    if budget < 1:
        raise RequestError('本批处理时间已到，已完成的批次会保留；请稍后继续。', 504, 'STEP_TIMEOUT')
    return budget


def read_limited(response, limit):
    """Bound bytes and wall time, including a streaming/slow upstream."""
    chunks, size = [], 0
    while True:
        timeout = remaining()
        try:
            response.fp.raw._sock.settimeout(timeout)
        except AttributeError:
            pass
        reader = getattr(response, 'read1', response.read)
        chunk = reader(min(65536, limit + 1 - size))
        if not chunk:
            return b''.join(chunks)
        chunks.append(chunk)
        size += len(chunk)
        if size > limit:
            raise RequestError('上游响应过大，请减少图片或链接后重试。', 502, 'UPSTREAM_TOO_LARGE')


class Admission:
    """Per-instance circuit guard. Platform firewall handles cross-instance abuse."""
    def __init__(self):
        self.lock = threading.Lock()
        self.buckets = OrderedDict()
        self.slots = threading.BoundedSemaphore(6)

    def acquire(self, address):
        now = time.monotonic()
        identity = hashlib.sha256(address.encode()).hexdigest()
        with self.lock:
            history = self.buckets.pop(identity, deque())
            while history and history[0] < now - 600:
                history.popleft()
            if len(history) >= 240:
                self.buckets[identity] = history
                raise RequestError('请求较频繁，请稍后继续；已完成结果会保留。', 429, 'RATE_LIMITED')
            history.append(now)
            self.buckets[identity] = history
            while len(self.buckets) > 2048:
                self.buckets.popitem(last=False)
        if not self.slots.acquire(blocking=False):
            raise RequestError('当前服务繁忙，请稍后继续。', 429, 'BUSY')


admission = Admission()
