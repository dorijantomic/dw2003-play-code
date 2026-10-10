"""Check player control without an emulator: uv run --with lupa python <this file>."""
from pathlib import Path
import unittest

from lupa.luajit21 import LuaRuntime


SCRIPT = Path(__file__).with_name("player-control.lua").read_text()
PRELUDE = """
calls={}; clears=0
function mark(s) calls[#calls+1]=s end
function print(s) end
emu={framecount=function() return 10 end}
joypad={set=function() mark('button') end,setanalog=function() mark('analog') end}
client={pause=function() mark('pause') end,unpause=function() mark('resume') end}
savestate={load=function() mark('load') end}
function releaseAll() clears=clears+1 end
function press() mark('press') end
function wr8() mark('write') end
function wr16() mark('write') end
function wr32() mark('write') end
function loadstate() savestate.load('x') end
function pause() client.pause() end
function resume() client.unpause() end
function rd32() return 123 end
"""


class PlayerControlTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute(PRELUDE)
        self.lua.execute(SCRIPT)

    def test_player_keeps_control_by_default(self):
        self.assertEqual(self.lua.eval("rig_control()"), "human")
        for operation in (
            "press(1,4)", "joypad.set({Cross=true},1)", "joypad.setanalog({})",
            "wr8(0,1)", "wr16(0,1)", "wr32(0,1)", "loadstate('x')",
            "savestate.load('x')", "pause()", "resume()",
        ):
            with self.subTest(operation=operation):
                self.assertFalse(self.lua.execute(
                    "local ok=pcall(function() " + operation + " end); return ok"))
        self.assertEqual(self.lua.eval("#calls"), 0)

    def test_observation_remains_available(self):
        self.assertEqual(self.lua.eval("rd32()"), 123)
        self.lua.execute("rig_player_status()")

    def test_requested_agent_control_then_handback(self):
        self.lua.execute("rig_control('agent'); press(1,4); joypad.set({Cross=true},1); loadstate('x')")
        self.assertEqual(self.lua.eval("#calls"), 3)
        self.lua.execute("rig_control('human')")
        self.assertFalse(self.lua.execute("local ok=pcall(press,1,4); return ok"))
        self.assertEqual(self.lua.eval("#calls"), 3)
        self.assertEqual(self.lua.eval("clears"), 3)

    def test_invalid_mode_does_not_enable_controls(self):
        self.assertFalse(self.lua.execute("local ok=pcall(rig_control,'unexpected'); return ok"))
        self.assertEqual(self.lua.eval("rig_control()"), "human")

    def test_reloading_guard_returns_control_to_player(self):
        self.lua.execute("rig_control('agent')")
        self.lua.execute(SCRIPT)
        self.assertEqual(self.lua.eval("rig_control()"), "human")
        self.assertFalse(self.lua.execute("local ok=pcall(press,1,4); return ok"))

    def test_rejects_wrong_emulator(self):
        other = LuaRuntime()
        other.execute(PRELUDE + "\nPCSX={}")
        ok = other.eval("function(s) local f=assert(loadstring(s)); local ok=pcall(f); return ok end")(SCRIPT)
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
