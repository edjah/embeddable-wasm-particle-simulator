FLAGS = -std=c++17
FLAGS += -O3
FLAGS += -s WASM=1
FLAGS += -s EXTRA_EXPORTED_RUNTIME_METHODS='["cwrap"]'

physics_engine: physics_engine.cpp
	emcc $(FLAGS) physics_engine.cpp -o build/physics_engine.js

clean:
	rm -rf build/*
