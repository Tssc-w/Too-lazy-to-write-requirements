import contextlib
import io
import json
import socket
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection, IncompleteRead
from http.server import ThreadingHTTPServer
from unittest.mock import patch
import urllib.request

import app
from reliability import RequestError, deadline, read_limited

PUBLIC_DNS = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))]
REFERENCE = {'title': 'Test product', 'product_id': 'test', 'url': 'https://example.com/product', 'image_urls': ['https://example.com/1.jpg']}
VALID_IMAGE = {'image_analyses': [{'index': 1, 'type': '卖点图', 'visual_observation': '产品旁有说明文字', 'recognized_text': []}]}


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.dns = patch.object(app.socket, 'getaddrinfo', return_value=PUBLIC_DNS)
        self.dns.start()
        self.ai_token = app._request_ai_config.set(('test-key', 'https://example.com/v1', 'test-model'))

    def tearDown(self):
        app._request_ai_config.reset(self.ai_token)
        self.dns.stop()

    def test_private_api_rejected(self):
        for url in ['https://127.0.0.1/v1', 'https://[::1]/v1', 'https://192.168.1.1/v1', 'http://example.com/v1', 'https://example.com:22/v1']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                app.normalize_ai_api_base_url(url)

    def test_mixed_dns_and_rebinding_blocked(self):
        with patch.object(app.socket, 'getaddrinfo', return_value=PUBLIC_DNS + [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(ValueError): app.normalize_ai_api_base_url('https://example.com/v1')
            with self.assertRaises(OSError): app._connect_public_socket('example.com', 443)

    def test_credential_redirects_never_forward(self):
        request = urllib.request.Request('https://example.com/v1', headers={'Authorization': 'Bearer secret'})
        for target in ['https://other.example/v1', 'http://example.com/v1', 'https://example.com/other']:
            with self.subTest(target=target), self.assertRaises(RequestError):
                app._CredentialRedirectHandler().redirect_request(request, None, 302, 'Found', {}, target)

    def test_block_and_title_only_pages_rejected(self):
        for source in ['<title>Access Denied</title>', '<title>Example Domain</title>', '<title>Just a moment...</title><meta property="og:image" content="https://example.com/challenge.png">']:
            with self.subTest(source=source), self.assertRaises(ValueError): app.parse_product_html('https://example.com/', '指定参考', source, '直采')

    def test_product_schema_is_accepted(self):
        source = '<title>Product</title><script type="application/ld+json">{"@type":"Product","name":"Test","image":"https://example.com/a.jpg"}</script>'
        result = app.parse_product_html('https://example.com/', '指定参考', source, '直采')
        self.assertEqual(result['title'], 'Test')
        self.assertEqual(len(result['image_urls']), 1)

    def test_empty_partial_duplicate_and_invalid_vision_fail(self):
        invalid = [{}, {'image_analyses': []}, {'image_analyses': [{'index': 'bad'}]}, {'image_analyses': [{'index': 1, 'type': 'unknown', 'visual_observation': 'test'}]}]
        for result in invalid:
            with self.subTest(result=result), patch.object(app, 'call_openai_chat', return_value=result), self.assertRaises(ValueError):
                app.call_openai_vision([REFERENCE], None, False)

    def test_valid_vision_keeps_original_position(self):
        with patch.object(app, 'call_openai_chat', return_value=VALID_IMAGE):
            result = app.call_openai_vision([REFERENCE], None, False, source_image_start=5)
        self.assertEqual(result['images'][0]['source_image_index'], 5)
        self.assertEqual(result['images'][0]['type'], '卖点图')

    def test_empty_summary_fails_without_fake_findings(self):
        with patch.object(app, 'call_openai_chat', return_value={}), self.assertRaises(ValueError):
            app.summarize_reference_analyses([REFERENCE], [{'images': [{'type': '卖点图', 'visual_observation': 'visible', 'image_url': REFERENCE['image_urls'][0]}]}], None, False)

    def test_response_size_and_deadline_bounded(self):
        with self.assertRaises(RequestError): read_limited(io.BytesIO(b'x' * 100), 20)
        token = deadline.set(time.monotonic() - 1)
        try:
            with self.assertRaises(RequestError): read_limited(io.BytesIO(b'x'), 20)
        finally: deadline.reset(token)

    def test_brightdata_fallback_preserves_both_attempts(self):
        with patch.object(app, 'fetch_product', side_effect=ValueError('Access denied')), patch.object(app, 'fetch_brightdata_product', return_value=dict(REFERENCE, fetch_method='brightdata')):
            result = app.research_link({'url': REFERENCE['url'], 'brightdata_api_token': 'test-only', 'brightdata_zone': 'zone'})
        self.assertEqual(len(result['item']['source_attempts']), 2)

    def test_failure_redacts_personal_collector_key(self):
        with patch.object(app, 'fetch_product', side_effect=ValueError('blocked')), patch.object(app, 'fetch_brightdata_product', side_effect=ValueError('bad test-only-key')):
            result = app.research_link({'url': REFERENCE['url'], 'brightdata_api_token': 'test-only-key', 'brightdata_zone': 'zone'})
        self.assertNotIn('test-only-key', json.dumps(result))
        self.assertEqual(result['item']['fetch_method'], 'failed')

    def test_batch_rejects_more_than_four_and_bad_positions(self):
        for reference, start in [(dict(REFERENCE, image_urls=REFERENCE['image_urls'] * 5), 1), (REFERENCE, 31), (REFERENCE, True)]:
            with self.subTest(start=start), self.assertRaises(ValueError):
                app.analysis_step({'_request_key': 'test', 'reference': reference, 'source_image_start': start})

    def test_summary_rejects_duplicate_records(self):
        image = {'source_image_index': 1, 'type': '卖点图', 'visual_observation': 'visible'}
        with self.assertRaises(ValueError):
            app.analysis_step({'_request_key': 'test', 'references': [REFERENCE], 'analyses': [{'images': [image, image]}]}, summary=True)

    def test_export_row_limit(self):
        with self.assertRaises(ValueError): app.export_workbook({'rows': [{}] * 201})

    def test_threadpool_personal_key_isolation(self):
        barrier = threading.Barrier(2)
        def read_key():
            barrier.wait(timeout=3)
            return app.get_ai_config()[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            tokens, futures = [], []
            try:
                for key in ['visitor-a', 'visitor-b']:
                    tokens.append(app._request_ai_config.set((key, 'https://example.com/v1', 'model')))
                    futures.append(app.submit_with_context(pool, read_key))
                self.assertEqual([future.result(timeout=4) for future in futures], ['visitor-a', 'visitor-b'])
            finally:
                for token in reversed(tokens): app._request_ai_config.reset(token)

    def test_transport_interruption_retries_and_sse_recovers(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'text/event-stream', 'x-request-id': 'test-upstream'}
        event = json.dumps({'choices': [{'delta': {'content': '{"ok":true}'}}]})
        response = Response(('data: ' + event + '\n\ndata: [DONE]\n\n').encode())
        with patch.object(app, 'credential_open', side_effect=[IncompleteRead(b''), response]) as transport, patch.object(app.time, 'sleep'):
            self.assertEqual(app.call_openai_chat([]), {'ok': True})
            self.assertEqual(transport.call_count, 2)

    def test_unsupported_single_image_skips_with_warning(self):
        with patch.object(app, 'call_openai_vision', side_effect=ValueError('unsupported image, supported PNG JPEG WEBP')):
            result = app.call_openai_vision_resilient([REFERENCE], None, False)
        self.assertEqual(result['images'], [])
        self.assertEqual(len(result['warnings']), 1)


class HandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path, data=None, headers=None):
        connection = HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request('POST' if data is not None else 'GET', path, body=data, headers=headers or {'Content-Type': 'application/json'})
        response = connection.getresponse()
        raw = response.read()
        result = (response.status, dict(response.getheaders()), raw)
        connection.close()
        return result

    def test_non_object_json_returns_400(self):
        status, headers, raw = self.request('/api/research/link', '[]')
        self.assertEqual(status, 400)
        self.assertIn('request_id', json.loads(raw))

    def test_wrong_content_type_returns_415(self):
        self.assertEqual(self.request('/api/research/link', '{}', {'Content-Type': 'text/plain'})[0], 415)

    def test_legacy_job_endpoint_no_longer_exposes_results(self):
        self.assertEqual(self.request('/api/jobs/test')[0], 410)

    def test_health_version_and_security_headers(self):
        status, headers, raw = self.request('/healthz')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['version'], app.BUILD_VERSION)
        self.assertIn('Content-Security-Policy', headers)

    def test_batch_requires_personal_key(self):
        status, _, raw = self.request('/api/analyze/batch', '{}')
        self.assertEqual(status, 400)
        self.assertIn('Key', json.loads(raw)['error'])

    def test_link_success_real_http_handler(self):
        with patch.object(app, 'research_link', return_value={'item': REFERENCE}):
            status, _, raw = self.request('/api/research/link', '{"url":"https://example.com/product"}')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['item']['title'], 'Test product')

    def test_vercel_rewritten_health_route(self):
        with patch.object(app, 'VERCEL_RUNTIME', True):
            status, _, raw = self.request('/api/index.py?__vercel_path=/healthz')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['version'], app.BUILD_VERSION)

    def test_private_api_rejected_before_any_transport(self):
        with patch.object(app, 'credential_open') as transport:
            status, _, raw = self.request('/api/models', '{"api_base_url":"https://127.0.0.1/v1"}', {'Content-Type': 'application/json', 'X-User-AI-Key': 'test'})
        self.assertEqual(status, 400)
        transport.assert_not_called()

    def test_batch_and_summary_through_handler_and_ai_parser(self):
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'application/json', 'x-request-id': 'test-request'}
        def ai_response(content):
            return Response(json.dumps({'choices': [{'message': {'content': json.dumps(content)}}]}).encode())
        headers = {'Content-Type': 'application/json', 'X-User-AI-Key': 'test-only'}
        summary = {'summary_points': ['a', 'b', 'c', 'd'], 'image_groups': [{'type': '卖点图', 'suggestions': [{'direction': 'first'}, {'direction': 'second'}]}]}
        resolve = socket.getaddrinfo
        def public_or_local(host, *args, **kwargs):
            return resolve(host, *args, **kwargs) if host == '127.0.0.1' else PUBLIC_DNS
        with patch.object(app.socket, 'getaddrinfo', side_effect=public_or_local), patch.object(app, 'credential_open', side_effect=[ai_response(VALID_IMAGE), ai_response(summary)]):
            status, _, raw = self.request('/api/analyze/batch', json.dumps({'reference': REFERENCE, 'api_base_url': 'https://example.com/v1'}), headers)
            self.assertEqual(status, 200, raw)
            batch_result = json.loads(raw)['result']
            status, _, raw = self.request('/api/analyze/summary', json.dumps({'references': [REFERENCE], 'analyses': [batch_result], 'api_base_url': 'https://example.com/v1'}), headers)
        self.assertEqual(status, 200, raw)
        result = json.loads(raw)['result']
        self.assertEqual(result['image_count'], 1)
        self.assertEqual(len(result['image_groups'][0]['suggestions']), 2)


if __name__ == '__main__': unittest.main()
