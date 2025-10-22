from building import *
import os

cwd = GetCurrentDir()
group = []
src = Glob('src/*.cpp')
src += Glob('src/driver/*.cpp')
if os.getenv("TEST_LED_IND"):
    src += Glob('test.cpp')

inc_path = cwd + '/src'

list = os.listdir(cwd)
for d in list:
    path = os.path.join(cwd, d)
    if os.path.isfile(os.path.join(path, 'SConscript')):
        group = group + SConscript(os.path.join(d, 'SConscript'))

group = group + DefineGroup('led_indicator_pp', src, depend = [''], CPPPATH = [inc_path], CPPDEFINES = ["USE_ULOG=1"])
Return('group')
