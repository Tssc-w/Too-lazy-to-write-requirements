"""Vercel Python Function entry point for the existing HTTP handler."""

from app import Handler


class handler(Handler):
    """Vercel invokes this request handler for every rewritten route."""
