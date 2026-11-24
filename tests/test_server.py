import unittest
import fitz
from fastapi.testclient import TestClient
from server.app import app
from unittest.mock import patch


class PlanUpload(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_first_page_and_embedded_text(self):
        with fitz.open() as doc:
            doc.new_page().insert_text((60, 60), "Garden")
            doc.new_page().insert_text((60, 60), "Other")
            with patch.dict("os.environ", {"OLLAMA_MODEL": ""}):
                response = self.client.post("/api/analyze", content=doc.tobytes())
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertIn("1 из 2", result["mode"])
        self.assertEqual([w["text"] for w in result["words"]], ["Garden"])
        self.assertIsNone(result["reference"])

    def test_corrupt_file(self):
        self.assertEqual(self.client.post("/api/analyze", content=b"wrong").status_code, 422)
