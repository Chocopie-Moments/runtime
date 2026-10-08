"""Synthetic replay of the real capture function; no device process is launched."""
import ast
import json
import pathlib
import tempfile
import unittest
from PIL import Image, ImageChops

# The script's top level drives a real installed app. Compile its actual capture owner
# without that entry point, injecting only the device/time boundaries for this replay.
source = pathlib.Path(__file__).with_name('verify-rn-consumer.py')
tree = ast.parse(source.read_text())
owner = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'capture')
code = compile(ast.Module(body=[owner], type_ignores=[]), str(source), 'exec')

class CaptureReplay(unittest.TestCase):
    def replay(self, colors):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        calls = []
        clock = [0.0]
        nodes = [
            {'rect': {'x': 0, 'y': 0, 'width': 20, 'height': 10}},
            {'label': 'Controlled moment', 'rect': {'x': 0, 'y': 0, 'width': 10, 'height': 10}},
            {'label': 'Independent paused moment', 'rect': {'x': 10, 'y': 0, 'width': 10, 'height': 10}},
        ]
        frames = iter(colors)
        def command(*parts):
            calls.append(parts)
            if parts[0] == 'screenshot':
                image = Image.new('RGB', (20, 10), 'white')
                image.paste(next(frames), (0, 0, 10, 10))
                image.save(parts[1])
        class Clock:
            @staticmethod
            def monotonic(): return clock[0]
            @staticmethod
            def sleep(seconds): clock[0] += seconds
        namespace = {'android': True, 'command': command, 'snapshot': lambda: nodes,
                     'output': pathlib.Path(directory.name), 'time': Clock,
                     'json': json, 'Image': Image, 'ImageChops': ImageChops}
        exec(code, namespace)
        return namespace['capture'], calls

    def test_strict_paused_sampling_rejects_transient_then_returning_frame(self):
        capture, calls = self.replay(['red', 'blue', 'red', 'red', 'red'])
        expected = {'Controlled moment': Image.new('RGB', (10, 10), 'red')}
        with self.assertRaisesRegex(AssertionError, 'advanced during strict sampling'):
            capture('paused-stable', expected_frame=expected)
        self.assertEqual(sum(call[0] == 'screenshot' for call in calls), 2)
        self.assertFalse(any(call[0] == 'scroll' for call in calls))

    def test_strict_paused_sampling_accepts_three_unchanged_frames_without_scroll(self):
        capture, calls = self.replay(['red', 'red', 'red'])
        expected = {'Controlled moment': Image.new('RGB', (10, 10), 'red')}
        result = capture('paused-stable', expected_frame=expected)
        self.assertIsNone(ImageChops.difference(expected['Controlled moment'], result['Controlled moment']).getbbox())
        self.assertEqual(sum(call[0] == 'screenshot' for call in calls), 3)
        self.assertFalse(any(call[0] == 'scroll' for call in calls))

if __name__ == '__main__': unittest.main()
