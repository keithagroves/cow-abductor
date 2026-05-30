How it works:
The “arc/ring” is a shader-drawn Gaussian band inside each planet’s atmosphere:
glsl



float h = (dist - r) / (ra - r);
float density = exp(-pow((h - 0.55) / 0.18, 2.0));

So the glow only exists around altitude h = 0.55, halfway-ish between the terrain envelope and atmosphere top. That’s the magic. It is not filling the whole atmosphere; it is a floating circular shell. Near the surface you see part of it as an arc overhead. When you climb away and zoom/framing changes, that same shell reads as a full ring around the planet.
Lighting is fake but effective:
glsl



vec2 toSun = normalize(u_sunPos - u_planetPos[i]);
float sunDot = dot(outward, toSun);
float dayNight = smoothstep(-0.15, 0.25, sunDot);

There is no visible sun. drawAtmosphere() uses [10000, -100] as the fallback sun position unless an actual isSun planet exists: atmosphere.js (line 135). In this branch, the actual sun planet is commented out in sketch.js (line 180), so the light source is just that fixed world point.
Color is two terms:
Rayleigh-ish blue on the day side:
glsl



vec3 rayleigh = u_atmoColor[i] * dayNight * density * 0.6;

Mie/sunset orange at the terminator:
glsl



float terminator = exp(-pow(sunDot * 1.6, 2.0) * 6.0);
vec3 mieColor = vec3(1.5, 0.55, 0.2) * terminator * density * dayNight * 0.5;

The other important layer is planet.js (line 238): it still draws a radial blue atmosphere gradient before the terrain body. That gives the planet a soft sky envelope, while the shader adds the sunlit arc/ring on top.
The rendering order is also part of the feel: planets render inside the camera transform, then drawAtmosphere() runs after pop() as a fullscreen shader overlay: sketch.js (line 379) and sketch.js (line 411). The shader reconstructs world position from screen pixels using view.focusX, view.focusY, view.scale, and view.rotation, so the ring stays locked to the planet while the camera follows the ship.