// Apple logo glass wallpaper: a Bezier-outline glass Apple mark lit by an
// orbiting warm/cool spotlight (fresnel rim, specular, refraction caustics,
// prismatic edges, bloom, vignette). Ported from
// https://github.com/xxidbr9/mac-os-shader-wallpaper (appleLogo.metal).
import {color, defineEffect, num} from "../effect.ts";
import {createGlslEffect} from "../glsl-effect.ts";

const FRAGMENT_GLSL = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;

// Motion
uniform float orbitSpeed;
uniform float orbitRadius;
// Light
uniform float colorPhase;
uniform float colorSaturation;
uniform vec4 warmColor;
uniform vec4 coolColor;
uniform vec4 neutralColor;
// Scene
uniform vec4 backgroundColor;
uniform vec4 glowColor;
uniform float glowIntensity;
uniform float beamIntensity;
uniform float bloomIntensity;
uniform float vignette;
uniform float exposure;
// Logo
uniform float logoScale;
uniform float offsetX;
uniform float offsetY;
// Glass
uniform float glassThickness;
uniform float specularStrength;
uniform float refractionStrength;
uniform float surfaceTexture;

#define PI 3.14159265359

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 37.7);
  return fract(p.x * p.y);
}

float noise21(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm21(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise21(p);
    p = rot(p, 0.71) * 2.05 + 13.7;
    a *= 0.5;
  }
  return v;
}

vec3 spectralEdge(float x) {
  return 0.52 + 0.48 * cos(2.0 * PI * (vec3(0.02, 0.25, 0.55) + x));
}

// Flattened cubic Bezier outline of the Apple logo from the source SVG,
// normalized to logo-local coordinates (+y up).
vec2 kAppleBody[295];
vec2 kAppleLeaf[90];

void loadOutlines() {
  kAppleBody[0] = vec2(0.8070126, -0.5586072);
  kAppleBody[1] = vec2(0.7986258, -0.5775264);
  kAppleBody[2] = vec2(0.7899631, -0.5961718);
  kAppleBody[3] = vec2(0.7810237, -0.6145450);
  kAppleBody[4] = vec2(0.7718072, -0.6326478);
  kAppleBody[5] = vec2(0.7623130, -0.6504819);
  kAppleBody[6] = vec2(0.7525406, -0.6680487);
  kAppleBody[7] = vec2(0.7424893, -0.6853502);
  kAppleBody[8] = vec2(0.7321586, -0.7023878);
  kAppleBody[9] = vec2(0.7215481, -0.7191633);
  kAppleBody[10] = vec2(0.7106570, -0.7356784);
  kAppleBody[11] = vec2(0.6994850, -0.7519347);
  kAppleBody[12] = vec2(0.6843189, -0.7733053);
  kAppleBody[13] = vec2(0.6696626, -0.7934455);
  kAppleBody[14] = vec2(0.6555177, -0.8123552);
  kAppleBody[15] = vec2(0.6418859, -0.8300345);
  kAppleBody[16] = vec2(0.6287689, -0.8464834);
  kAppleBody[17] = vec2(0.6161683, -0.8617018);
  kAppleBody[18] = vec2(0.6040859, -0.8756897);
  kAppleBody[19] = vec2(0.5925232, -0.8884472);
  kAppleBody[20] = vec2(0.5814820, -0.8999743);
  kAppleBody[21] = vec2(0.5709639, -0.9102709);
  kAppleBody[22] = vec2(0.5609706, -0.9193370);
  kAppleBody[23] = vec2(0.5442598, -0.9338516);
  kAppleBody[24] = vec2(0.5273104, -0.9468789);
  kAppleBody[25] = vec2(0.5101211, -0.9584203);
  kAppleBody[26] = vec2(0.4926902, -0.9684772);
  kAppleBody[27] = vec2(0.4750164, -0.9770513);
  kAppleBody[28] = vec2(0.4570982, -0.9841439);
  kAppleBody[29] = vec2(0.4389341, -0.9897566);
  kAppleBody[30] = vec2(0.4205225, -0.9938908);
  kAppleBody[31] = vec2(0.4018621, -0.9965480);
  kAppleBody[32] = vec2(0.3829513, -0.9977297);
  kAppleBody[33] = vec2(0.3690040, -0.9973405);
  kAppleBody[34] = vec2(0.3544959, -0.9961712);
  kAppleBody[35] = vec2(0.3394293, -0.9942198);
  kAppleBody[36] = vec2(0.3238064, -0.9914840);
  kAppleBody[37] = vec2(0.3076295, -0.9879615);
  kAppleBody[38] = vec2(0.2909008, -0.9836501);
  kAppleBody[39] = vec2(0.2736224, -0.9785477);
  kAppleBody[40] = vec2(0.2557966, -0.9726519);
  kAppleBody[41] = vec2(0.2374257, -0.9659607);
  kAppleBody[42] = vec2(0.2185118, -0.9584716);
  kAppleBody[43] = vec2(0.1994201, -0.9510160);
  kAppleBody[44] = vec2(0.1806392, -0.9443516);
  kAppleBody[45] = vec2(0.1621684, -0.9384767);
  kAppleBody[46] = vec2(0.1440068, -0.9333899);
  kAppleBody[47] = vec2(0.1261535, -0.9290898);
  kAppleBody[48] = vec2(0.1086076, -0.9255748);
  kAppleBody[49] = vec2(0.0913682, -0.9228436);
  kAppleBody[50] = vec2(0.0744344, -0.9208945);
  kAppleBody[51] = vec2(0.0578054, -0.9197261);
  kAppleBody[52] = vec2(0.0414802, -0.9193370);
  kAppleBody[53] = vec2(0.0243946, -0.9197261);
  kAppleBody[54] = vec2(0.0070624, -0.9208945);
  kAppleBody[55] = vec2(-0.0105172, -0.9228436);
  kAppleBody[56] = vec2(-0.0283449, -0.9255748);
  kAppleBody[57] = vec2(-0.0464215, -0.9290898);
  kAppleBody[58] = vec2(-0.0647477, -0.9333899);
  kAppleBody[59] = vec2(-0.0833243, -0.9384767);
  kAppleBody[60] = vec2(-0.1021520, -0.9443516);
  kAppleBody[61] = vec2(-0.1212316, -0.9510160);
  kAppleBody[62] = vec2(-0.1405637, -0.9584716);
  kAppleBody[63] = vec2(-0.1596734, -0.9659828);
  kAppleBody[64] = vec2(-0.1780273, -0.9727398);
  kAppleBody[65] = vec2(-0.1956270, -0.9787443);
  kAppleBody[66] = vec2(-0.2124746, -0.9839978);
  kAppleBody[67] = vec2(-0.2285719, -0.9885016);
  kAppleBody[68] = vec2(-0.2439206, -0.9922573);
  kAppleBody[69] = vec2(-0.2585227, -0.9952663);
  kAppleBody[70] = vec2(-0.2723800, -0.9975302);
  kAppleBody[71] = vec2(-0.2854943, -0.9990504);
  kAppleBody[72] = vec2(-0.2978676, -0.9998284);
  kAppleBody[73] = vec2(-0.3161168, -0.9997246);
  kAppleBody[74] = vec2(-0.3343546, -0.9978571);
  kAppleBody[75] = vec2(-0.3525816, -0.9942252);
  kAppleBody[76] = vec2(-0.3707983, -0.9888282);
  kAppleBody[77] = vec2(-0.3890053, -0.9816654);
  kAppleBody[78] = vec2(-0.4072030, -0.9727359);
  kAppleBody[79] = vec2(-0.4253919, -0.9620390);
  kAppleBody[80] = vec2(-0.4435726, -0.9495741);
  kAppleBody[81] = vec2(-0.4617456, -0.9353404);
  kAppleBody[82] = vec2(-0.4799115, -0.9193370);
  kAppleBody[83] = vec2(-0.4906901, -0.9095485);
  kAppleBody[84] = vec2(-0.5019486, -0.8985663);
  kAppleBody[85] = vec2(-0.5136866, -0.8863903);
  kAppleBody[86] = vec2(-0.5259035, -0.8730207);
  kAppleBody[87] = vec2(-0.5385987, -0.8584573);
  kAppleBody[88] = vec2(-0.5517717, -0.8427002);
  kAppleBody[89] = vec2(-0.5654219, -0.8257494);
  kAppleBody[90] = vec2(-0.5795488, -0.8076049);
  kAppleBody[91] = vec2(-0.5941517, -0.7882666);
  kAppleBody[92] = vec2(-0.6092302, -0.7677346);
  kAppleBody[93] = vec2(-0.6247836, -0.7460089);
  kAppleBody[94] = vec2(-0.6363019, -0.7294570);
  kAppleBody[95] = vec2(-0.6475613, -0.7125777);
  kAppleBody[96] = vec2(-0.6585616, -0.6953708);
  kAppleBody[97] = vec2(-0.6693029, -0.6778358);
  kAppleBody[98] = vec2(-0.6797852, -0.6599724);
  kAppleBody[99] = vec2(-0.6900084, -0.6417803);
  kAppleBody[100] = vec2(-0.6999726, -0.6232590);
  kAppleBody[101] = vec2(-0.7096777, -0.6044083);
  kAppleBody[102] = vec2(-0.7191236, -0.5852276);
  kAppleBody[103] = vec2(-0.7283105, -0.5657168);
  kAppleBody[104] = vec2(-0.7372382, -0.5458754);
  kAppleBody[105] = vec2(-0.7459067, -0.5257031);
  kAppleBody[106] = vec2(-0.7543161, -0.5051994);
  kAppleBody[107] = vec2(-0.7624662, -0.4843641);
  kAppleBody[108] = vec2(-0.7703572, -0.4631968);
  kAppleBody[109] = vec2(-0.7779889, -0.4416971);
  kAppleBody[110] = vec2(-0.7849327, -0.4209319);
  kAppleBody[111] = vec2(-0.7914808, -0.4002396);
  kAppleBody[112] = vec2(-0.7976328, -0.3796204);
  kAppleBody[113] = vec2(-0.8033888, -0.3590739);
  kAppleBody[114] = vec2(-0.8087486, -0.3386003);
  kAppleBody[115] = vec2(-0.8137121, -0.3181993);
  kAppleBody[116] = vec2(-0.8182791, -0.2978708);
  kAppleBody[117] = vec2(-0.8224497, -0.2776148);
  kAppleBody[118] = vec2(-0.8262235, -0.2574311);
  kAppleBody[119] = vec2(-0.8296006, -0.2373197);
  kAppleBody[120] = vec2(-0.8325809, -0.2172804);
  kAppleBody[121] = vec2(-0.8351641, -0.1973131);
  kAppleBody[122] = vec2(-0.8373502, -0.1774178);
  kAppleBody[123] = vec2(-0.8391391, -0.1575943);
  kAppleBody[124] = vec2(-0.8405307, -0.1378426);
  kAppleBody[125] = vec2(-0.8415248, -0.1181625);
  kAppleBody[126] = vec2(-0.8421214, -0.0985539);
  kAppleBody[127] = vec2(-0.8423203, -0.0790167);
  kAppleBody[128] = vec2(-0.8420196, -0.0555553);
  kAppleBody[129] = vec2(-0.8411175, -0.0324768);
  kAppleBody[130] = vec2(-0.8396140, -0.0097817);
  kAppleBody[131] = vec2(-0.8375088, 0.0125296);
  kAppleBody[132] = vec2(-0.8348020, 0.0344568);
  kAppleBody[133] = vec2(-0.8314933, 0.0559996);
  kAppleBody[134] = vec2(-0.8275826, 0.0771575);
  kAppleBody[135] = vec2(-0.8230700, 0.0979302);
  kAppleBody[136] = vec2(-0.8179552, 0.1183174);
  kAppleBody[137] = vec2(-0.8122382, 0.1383187);
  kAppleBody[138] = vec2(-0.8059189, 0.1579336);
  kAppleBody[139] = vec2(-0.7989971, 0.1771619);
  kAppleBody[140] = vec2(-0.7914727, 0.1960033);
  kAppleBody[141] = vec2(-0.7833457, 0.2144572);
  kAppleBody[142] = vec2(-0.7746159, 0.2325235);
  kAppleBody[143] = vec2(-0.7652832, 0.2502016);
  kAppleBody[144] = vec2(-0.7553476, 0.2674913);
  kAppleBody[145] = vec2(-0.7445591, 0.2851564);
  kAppleBody[146] = vec2(-0.7332353, 0.3022384);
  kAppleBody[147] = vec2(-0.7213758, 0.3187377);
  kAppleBody[148] = vec2(-0.7089799, 0.3346545);
  kAppleBody[149] = vec2(-0.6960471, 0.3499891);
  kAppleBody[150] = vec2(-0.6825769, 0.3647419);
  kAppleBody[151] = vec2(-0.6685688, 0.3789131);
  kAppleBody[152] = vec2(-0.6540221, 0.3925031);
  kAppleBody[153] = vec2(-0.6389364, 0.4055122);
  kAppleBody[154] = vec2(-0.6233112, 0.4179406);
  kAppleBody[155] = vec2(-0.6071458, 0.4297886);
  kAppleBody[156] = vec2(-0.5904398, 0.4410567);
  kAppleBody[157] = vec2(-0.5731926, 0.4517450);
  kAppleBody[158] = vec2(-0.5555660, 0.4617515);
  kAppleBody[159] = vec2(-0.5377220, 0.4709752);
  kAppleBody[160] = vec2(-0.5196599, 0.4794176);
  kAppleBody[161] = vec2(-0.5013792, 0.4870804);
  kAppleBody[162] = vec2(-0.4828795, 0.4939653);
  kAppleBody[163] = vec2(-0.4641600, 0.5000739);
  kAppleBody[164] = vec2(-0.4452204, 0.5054078);
  kAppleBody[165] = vec2(-0.4260601, 0.5099688);
  kAppleBody[166] = vec2(-0.4066784, 0.5137584);
  kAppleBody[167] = vec2(-0.3870750, 0.5167784);
  kAppleBody[168] = vec2(-0.3672492, 0.5190303);
  kAppleBody[169] = vec2(-0.3472005, 0.5205159);
  kAppleBody[170] = vec2(-0.3269284, 0.5212367);
  kAppleBody[171] = vec2(-0.3119771, 0.5207887);
  kAppleBody[172] = vec2(-0.2961208, 0.5194468);
  kAppleBody[173] = vec2(-0.2793576, 0.5172142);
  kAppleBody[174] = vec2(-0.2616854, 0.5140938);
  kAppleBody[175] = vec2(-0.2431023, 0.5100889);
  kAppleBody[176] = vec2(-0.2236062, 0.5052025);
  kAppleBody[177] = vec2(-0.2031953, 0.4994378);
  kAppleBody[178] = vec2(-0.1818674, 0.4927979);
  kAppleBody[179] = vec2(-0.1596205, 0.4852858);
  kAppleBody[180] = vec2(-0.1364527, 0.4769047);
  kAppleBody[181] = vec2(-0.1137340, 0.4684969);
  kAppleBody[182] = vec2(-0.0927031, 0.4609634);
  kAppleBody[183] = vec2(-0.0733614, 0.4543067);
  kAppleBody[184] = vec2(-0.0557101, 0.4485295);
  kAppleBody[185] = vec2(-0.0397504, 0.4436341);
  kAppleBody[186] = vec2(-0.0254836, 0.4396232);
  kAppleBody[187] = vec2(-0.0129110, 0.4364992);
  kAppleBody[188] = vec2(-0.0020339, 0.4342646);
  kAppleBody[189] = vec2(0.0071466, 0.4329220);
  kAppleBody[190] = vec2(0.0146291, 0.4324740);
  kAppleBody[191] = vec2(0.0207725, 0.4329983);
  kAppleBody[192] = vec2(0.0292821, 0.4345708);
  kAppleBody[193] = vec2(0.0401548, 0.4371908);
  kAppleBody[194] = vec2(0.0533873, 0.4408577);
  kAppleBody[195] = vec2(0.0689762, 0.4455708);
  kAppleBody[196] = vec2(0.0869185, 0.4513294);
  kAppleBody[197] = vec2(0.1072107, 0.4581328);
  kAppleBody[198] = vec2(0.1298497, 0.4659805);
  kAppleBody[199] = vec2(0.1548322, 0.4748717);
  kAppleBody[200] = vec2(0.1821549, 0.4848057);
  kAppleBody[201] = vec2(0.2063020, 0.4931509);
  kAppleBody[202] = vec2(0.2297556, 0.5005584);
  kAppleBody[203] = vec2(0.2525172, 0.5070293);
  kAppleBody[204] = vec2(0.2745881, 0.5125651);
  kAppleBody[205] = vec2(0.2959699, 0.5171669);
  kAppleBody[206] = vec2(0.3166638, 0.5208360);
  kAppleBody[207] = vec2(0.3366712, 0.5235738);
  kAppleBody[208] = vec2(0.3559935, 0.5253814);
  kAppleBody[209] = vec2(0.3746322, 0.5262603);
  kAppleBody[210] = vec2(0.3925886, 0.5262115);
  kAppleBody[211] = vec2(0.4098641, 0.5252366);
  kAppleBody[212] = vec2(0.4325501, 0.5230578);
  kAppleBody[213] = vec2(0.4547170, 0.5202248);
  kAppleBody[214] = vec2(0.4763645, 0.5167374);
  kAppleBody[215] = vec2(0.4974924, 0.5125953);
  kAppleBody[216] = vec2(0.5181003, 0.5077984);
  kAppleBody[217] = vec2(0.5381881, 0.5023463);
  kAppleBody[218] = vec2(0.5577554, 0.4962389);
  kAppleBody[219] = vec2(0.5768019, 0.4894758);
  kAppleBody[220] = vec2(0.5953274, 0.4820569);
  kAppleBody[221] = vec2(0.6133316, 0.4739820);
  kAppleBody[222] = vec2(0.6308142, 0.4652507);
  kAppleBody[223] = vec2(0.6477749, 0.4558629);
  kAppleBody[224] = vec2(0.6642135, 0.4458184);
  kAppleBody[225] = vec2(0.6801296, 0.4351168);
  kAppleBody[226] = vec2(0.6955231, 0.4237579);
  kAppleBody[227] = vec2(0.7103935, 0.4117415);
  kAppleBody[228] = vec2(0.7247407, 0.3990675);
  kAppleBody[229] = vec2(0.7385644, 0.3857354);
  kAppleBody[230] = vec2(0.7518642, 0.3717452);
  kAppleBody[231] = vec2(0.7646400, 0.3570965);
  kAppleBody[232] = vec2(0.7768913, 0.3417891);
  kAppleBody[233] = vec2(0.7886181, 0.3258229);
  kAppleBody[234] = vec2(0.7694203, 0.3137224);
  kAppleBody[235] = vec2(0.7510850, 0.3012078);
  kAppleBody[236] = vec2(0.7336121, 0.2882792);
  kAppleBody[237] = vec2(0.7170016, 0.2749370);
  kAppleBody[238] = vec2(0.7012533, 0.2611812);
  kAppleBody[239] = vec2(0.6863673, 0.2470121);
  kAppleBody[240] = vec2(0.6723435, 0.2324298);
  kAppleBody[241] = vec2(0.6591818, 0.2174347);
  kAppleBody[242] = vec2(0.6468821, 0.2020268);
  kAppleBody[243] = vec2(0.6354444, 0.1862064);
  kAppleBody[244] = vec2(0.6248687, 0.1699737);
  kAppleBody[245] = vec2(0.6151548, 0.1533289);
  kAppleBody[246] = vec2(0.6063027, 0.1362722);
  kAppleBody[247] = vec2(0.5983124, 0.1188037);
  kAppleBody[248] = vec2(0.5911838, 0.1009238);
  kAppleBody[249] = vec2(0.5849168, 0.0826325);
  kAppleBody[250] = vec2(0.5795113, 0.0639301);
  kAppleBody[251] = vec2(0.5749674, 0.0448168);
  kAppleBody[252] = vec2(0.5712849, 0.0252928);
  kAppleBody[253] = vec2(0.5684637, 0.0053583);
  kAppleBody[254] = vec2(0.5665039, -0.0149865);
  kAppleBody[255] = vec2(0.5654054, -0.0357415);
  kAppleBody[256] = vec2(0.5651680, -0.0569063);
  kAppleBody[257] = vec2(0.5658104, -0.0779768);
  kAppleBody[258] = vec2(0.5672847, -0.0986502);
  kAppleBody[259] = vec2(0.5695906, -0.1189260);
  kAppleBody[260] = vec2(0.5727280, -0.1388037);
  kAppleBody[261] = vec2(0.5766965, -0.1582829);
  kAppleBody[262] = vec2(0.5814958, -0.1773631);
  kAppleBody[263] = vec2(0.5871259, -0.1960438);
  kAppleBody[264] = vec2(0.5935863, -0.2143246);
  kAppleBody[265] = vec2(0.6008768, -0.2322050);
  kAppleBody[266] = vec2(0.6089973, -0.2496845);
  kAppleBody[267] = vec2(0.6179473, -0.2667627);
  kAppleBody[268] = vec2(0.6277267, -0.2834390);
  kAppleBody[269] = vec2(0.6383353, -0.2997130);
  kAppleBody[270] = vec2(0.6497727, -0.3155843);
  kAppleBody[271] = vec2(0.6620387, -0.3310524);
  kAppleBody[272] = vec2(0.6751330, -0.3461167);
  kAppleBody[273] = vec2(0.6890555, -0.3607769);
  kAppleBody[274] = vec2(0.7038058, -0.3750325);
  kAppleBody[275] = vec2(0.7163206, -0.3865063);
  kAppleBody[276] = vec2(0.7291265, -0.3974476);
  kAppleBody[277] = vec2(0.7422258, -0.4078570);
  kAppleBody[278] = vec2(0.7556205, -0.4177354);
  kAppleBody[279] = vec2(0.7693131, -0.4270834);
  kAppleBody[280] = vec2(0.7833056, -0.4359018);
  kAppleBody[281] = vec2(0.7976004, -0.4441913);
  kAppleBody[282] = vec2(0.8121996, -0.4519526);
  kAppleBody[283] = vec2(0.8271054, -0.4591866);
  kAppleBody[284] = vec2(0.8423201, -0.4658939);
  kAppleBody[285] = vec2(0.8389683, -0.4755197);
  kAppleBody[286] = vec2(0.8355786, -0.4850647);
  kAppleBody[287] = vec2(0.8321504, -0.4945297);
  kAppleBody[288] = vec2(0.8286830, -0.5039155);
  kAppleBody[289] = vec2(0.8251756, -0.5132227);
  kAppleBody[290] = vec2(0.8216274, -0.5224522);
  kAppleBody[291] = vec2(0.8180378, -0.5316047);
  kAppleBody[292] = vec2(0.8144059, -0.5406808);
  kAppleBody[293] = vec2(0.8107311, -0.5496814);
  kAppleBody[294] = vec2(0.8070126, -0.5586072);
  kAppleLeaf[0] = vec2(0.4210983, 0.9599889);
  kAppleLeaf[1] = vec2(0.4206112, 0.9400728);
  kAppleLeaf[2] = vec2(0.4191500, 0.9203342);
  kAppleLeaf[3] = vec2(0.4167152, 0.9007735);
  kAppleLeaf[4] = vec2(0.4133073, 0.8813914);
  kAppleLeaf[5] = vec2(0.4089268, 0.8621883);
  kAppleLeaf[6] = vec2(0.4035739, 0.8431650);
  kAppleLeaf[7] = vec2(0.3972492, 0.8243219);
  kAppleLeaf[8] = vec2(0.3899532, 0.8056596);
  kAppleLeaf[9] = vec2(0.3816862, 0.7871786);
  kAppleLeaf[10] = vec2(0.3724487, 0.7688796);
  kAppleLeaf[11] = vec2(0.3622411, 0.7507631);
  kAppleLeaf[12] = vec2(0.3510639, 0.7328296);
  kAppleLeaf[13] = vec2(0.3389175, 0.7150797);
  kAppleLeaf[14] = vec2(0.3258024, 0.6975141);
  kAppleLeaf[15] = vec2(0.3117189, 0.6801331);
  kAppleLeaf[16] = vec2(0.2969002, 0.6634121);
  kAppleLeaf[17] = vec2(0.2817501, 0.6475205);
  kAppleLeaf[18] = vec2(0.2662784, 0.6324845);
  kAppleLeaf[19] = vec2(0.2504947, 0.6183302);
  kAppleLeaf[20] = vec2(0.2344088, 0.6050836);
  kAppleLeaf[21] = vec2(0.2180304, 0.5927709);
  kAppleLeaf[22] = vec2(0.2013692, 0.5814181);
  kAppleLeaf[23] = vec2(0.1844348, 0.5710514);
  kAppleLeaf[24] = vec2(0.1672372, 0.5616969);
  kAppleLeaf[25] = vec2(0.1497858, 0.5533806);
  kAppleLeaf[26] = vec2(0.1320906, 0.5461287);
  kAppleLeaf[27] = vec2(0.1141611, 0.5399673);
  kAppleLeaf[28] = vec2(0.0960071, 0.5349224);
  kAppleLeaf[29] = vec2(0.0776383, 0.5310202);
  kAppleLeaf[30] = vec2(0.0590645, 0.5282867);
  kAppleLeaf[31] = vec2(0.0402953, 0.5267481);
  kAppleLeaf[32] = vec2(0.0213405, 0.5264305);
  kAppleLeaf[33] = vec2(0.0022097, 0.5273600);
  kAppleLeaf[34] = vec2(0.0017878, 0.5309788);
  kAppleLeaf[35] = vec2(0.0014042, 0.5346354);
  kAppleLeaf[36] = vec2(0.0010606, 0.5383300);
  kAppleLeaf[37] = vec2(0.0007581, 0.5420625);
  kAppleLeaf[38] = vec2(0.0004984, 0.5458332);
  kAppleLeaf[39] = vec2(0.0002827, 0.5496420);
  kAppleLeaf[40] = vec2(0.0001125, 0.5534890);
  kAppleLeaf[41] = vec2(-0.0000108, 0.5573743);
  kAppleLeaf[42] = vec2(-0.0000858, 0.5612979);
  kAppleLeaf[43] = vec2(-0.0001112, 0.5652601);
  kAppleLeaf[44] = vec2(0.0004434, 0.5845467);
  kAppleLeaf[45] = vec2(0.0020960, 0.6039679);
  kAppleLeaf[46] = vec2(0.0048300, 0.6234782);
  kAppleLeaf[47] = vec2(0.0086287, 0.6430323);
  kAppleLeaf[48] = vec2(0.0134755, 0.6625850);
  kAppleLeaf[49] = vec2(0.0193537, 0.6820909);
  kAppleLeaf[50] = vec2(0.0262467, 0.7015048);
  kAppleLeaf[51] = vec2(0.0341377, 0.7207813);
  kAppleLeaf[52] = vec2(0.0430102, 0.7398752);
  kAppleLeaf[53] = vec2(0.0528474, 0.7587412);
  kAppleLeaf[54] = vec2(0.0636328, 0.7773339);
  kAppleLeaf[55] = vec2(0.0753497, 0.7956081);
  kAppleLeaf[56] = vec2(0.0879813, 0.8135184);
  kAppleLeaf[57] = vec2(0.1015111, 0.8310196);
  kAppleLeaf[58] = vec2(0.1159224, 0.8480663);
  kAppleLeaf[59] = vec2(0.1273427, 0.8606138);
  kAppleLeaf[60] = vec2(0.1393672, 0.8727313);
  kAppleLeaf[61] = vec2(0.1519955, 0.8844188);
  kAppleLeaf[62] = vec2(0.1652273, 0.8956764);
  kAppleLeaf[63] = vec2(0.1790624, 0.9065042);
  kAppleLeaf[64] = vec2(0.1935005, 0.9169023);
  kAppleLeaf[65] = vec2(0.2085411, 0.9268707);
  kAppleLeaf[66] = vec2(0.2241842, 0.9364096);
  kAppleLeaf[67] = vec2(0.2404293, 0.9455189);
  kAppleLeaf[68] = vec2(0.2572761, 0.9541989);
  kAppleLeaf[69] = vec2(0.2742940, 0.9621649);
  kAppleLeaf[70] = vec2(0.2911259, 0.9693835);
  kAppleLeaf[71] = vec2(0.3077712, 0.9758528);
  kAppleLeaf[72] = vec2(0.3242291, 0.9815710);
  kAppleLeaf[73] = vec2(0.3404989, 0.9865362);
  kAppleLeaf[74] = vec2(0.3565798, 0.9907464);
  kAppleLeaf[75] = vec2(0.3724710, 0.9941998);
  kAppleLeaf[76] = vec2(0.3881719, 0.9968945);
  kAppleLeaf[77] = vec2(0.4036817, 0.9988285);
  kAppleLeaf[78] = vec2(0.4189996, 1.0000000);
  kAppleLeaf[79] = vec2(0.4194184, 0.9959887);
  kAppleLeaf[80] = vec2(0.4197867, 0.9919780);
  kAppleLeaf[81] = vec2(0.4201062, 0.9879685);
  kAppleLeaf[82] = vec2(0.4203783, 0.9839608);
  kAppleLeaf[83] = vec2(0.4206045, 0.9799557);
  kAppleLeaf[84] = vec2(0.4207862, 0.9759537);
  kAppleLeaf[85] = vec2(0.4209250, 0.9719555);
  kAppleLeaf[86] = vec2(0.4210223, 0.9679617);
  kAppleLeaf[87] = vec2(0.4210795, 0.9639731);
  kAppleLeaf[88] = vec2(0.4210983, 0.9599901);
  kAppleLeaf[89] = vec2(0.4210983, 0.9599889);
}

// Closest-edge distance: the direction from the closest segment point to pt
// is the SDF gradient, returned alongside the distance so no screen-space
// derivatives are needed (OES_standard_derivatives is no longer exposed by
// current Chrome WebGL1).
void bodyDistance(vec2 pt, out float d, out vec2 grad) {
  float d2 = 1e20;
  bool inside = false;
  vec2 bestGrad = vec2(0.0, 0.0);
  for (int i = 0; i < 294; i++) {
    vec2 a = kAppleBody[i];
    vec2 b = kAppleBody[i + 1];
    vec2 ba = b - a;
    float h = clamp(dot(pt - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
    vec2 dv = pt - (a + ba * h);
    float nd2 = dot(dv, dv);
    if (nd2 < d2) {
      d2 = nd2;
      bestGrad = normalize(dv + vec2(1e-9));
    }
    bool crosses = ((a.y > pt.y) != (b.y > pt.y));
    if (crosses) {
      float x = a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (pt.x < x) {
        inside = !inside;
      }
    }
  }
  d = sqrt(d2) * (inside ? -1.0 : 1.0);
  // Outside, the SDF grows away from the boundary; inside, toward it.
  grad = bestGrad * (inside ? -1.0 : 1.0);
}

void leafDistance(vec2 pt, out float d, out vec2 grad) {
  float d2 = 1e20;
  bool inside = false;
  vec2 bestGrad = vec2(0.0, 0.0);
  for (int i = 0; i < 89; i++) {
    vec2 a = kAppleLeaf[i];
    vec2 b = kAppleLeaf[i + 1];
    vec2 ba = b - a;
    float h = clamp(dot(pt - a, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
    vec2 dv = pt - (a + ba * h);
    float nd2 = dot(dv, dv);
    if (nd2 < d2) {
      d2 = nd2;
      bestGrad = normalize(dv + vec2(1e-9));
    }
    bool crosses = ((a.y > pt.y) != (b.y > pt.y));
    if (crosses) {
      float x = a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (pt.x < x) {
        inside = !inside;
      }
    }
  }
  d = sqrt(d2) * (inside ? -1.0 : 1.0);
  grad = bestGrad * (inside ? -1.0 : 1.0);
}

vec4 effect(vec2 uv) {
  vec2 centered = uv - 0.5;
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  // gl_FragCoord.y is up, matching the logo-local +y-up convention.
  vec2 q = vec2(centered.x * aspect, centered.y);
  float t = iTime;

  vec2 logoCenter = vec2(offsetX, offsetY);
  vec2 p = (q - logoCenter) / logoScale;

  float bodyLocalD;
  vec2 bodyGrad;
  bodyDistance(p, bodyLocalD, bodyGrad);
  float leafLocalD;
  vec2 leafGrad;
  leafDistance(p, leafLocalD, leafGrad);
  float bodyD = bodyLocalD * logoScale;
  float leafD = leafLocalD * logoScale;
  float logoD = min(bodyD, leafD);

  // The polygon distance fields have unit gradient, so the screen-space AA
  // width is one pixel (in q units) regardless of logo scale.
  float pixelSize = 1.0 / iResolution.y;
  float bodyAA = max(pixelSize, 0.0012);
  float leafAA = max(pixelSize, 0.0012);
  float bodyMask = 1.0 - smoothstep(-bodyAA, bodyAA, bodyD);
  float leafMask = 1.0 - smoothstep(-leafAA, leafAA, leafD);
  float logoMask = max(bodyMask, leafMask);
  float outsideMask = 1.0 - logoMask;

  // Near-black field with a soft aura around the logo.
  float vignetteR = length(q - logoCenter);
  vec3 color = vec3(0.0);
  color += backgroundColor.rgb * smoothstep(1.10, 0.10, vignetteR);

  // Orbital spotlight: the light lives outside the screen and always aims at
  // the screen center; one revolution takes ~45 s at orbitSpeed 1.
  float lightAngle = t * -0.14 * orbitSpeed;
  float screenRadius = length(vec2(aspect, 1.0)) * orbitRadius + 0.35;
  vec2 lightScreenPos = vec2(cos(lightAngle), sin(lightAngle)) * screenRadius;
  vec2 beamDir = normalize(-lightScreenPos);
  vec2 lightDir = normalize(lightScreenPos - logoCenter);
  vec2 beamTangent = vec2(-beamDir.y, beamDir.x);
  vec3 lightColor = mix(warmColor.rgb, coolColor.rgb, 0.5 + 0.5 * sin(lightAngle + colorPhase));
  lightColor = mix(neutralColor.rgb, lightColor, colorSaturation);

  vec2 lightToFrag = q - lightScreenPos;
  float beamTravel = dot(lightToFrag, beamDir);
  float beamPerp = abs(dot(lightToFrag, beamTangent));
  float beamWidth = 0.060 + beamTravel * 0.095;
  float screenBeam = exp(-(beamPerp * beamPerp) / max(beamWidth * beamWidth, 1e-4))
                   * smoothstep(0.0, 0.28, beamTravel)
                   * smoothstep(screenRadius * 1.55, screenRadius * 0.20, beamTravel);
  float centerFocus = exp(-dot((q - logoCenter) / (logoScale * vec2(1.45, 1.20)), (q - logoCenter) / (logoScale * vec2(1.45, 1.20))));

  float outside = max(logoD, 0.0);
  float broadGlow = exp(-outside * 6.0) * outsideMask;
  float tightGlow = exp(-outside * 34.0) * outsideMask;
  vec2 logoRadial = normalize(p - vec2(0.0, -0.04));
  float exteriorLight = smoothstep(-0.30, 0.95, dot(logoRadial, lightDir));
  float orbitalAura = screenBeam * centerFocus * outsideMask;
  color += glowColor.rgb * broadGlow * glowIntensity;
  color += lightColor * screenBeam * outsideMask * 0.055 * beamIntensity;
  color += lightColor * tightGlow * (0.04 + 0.68 * exteriorLight * screenBeam * beamIntensity);
  color += lightColor * orbitalAura * 0.42 * beamIntensity;

  // Rounded virtual 3D glass volume: domed apple/leaf height field, rounded
  // rim normals, Fresnel reflection and refracted caustics over the flat
  // silhouette mask.
  float n = fbm21(p * 2.1 + vec2(t * 0.018, -t * 0.013));
  float bodyInner = max(-bodyD, 0.0);
  float bodyInnerLocal = max(-bodyLocalD, 0.0);
  vec2 bodyP = p - vec2(0.02, -0.20);
  float bodyS = length(bodyP / vec2(0.82, 1.02));
  float bodyRound = pow(clamp(1.0 - bodyS * bodyS, 0.0, 1.0), 0.58);
  float bodyLowerFullness = 1.0 + 0.13 * max(0.0, -normalize(bodyP + vec2(1e-4)).y);
  float bodyHeight = 0.05 + glassThickness * bodyRound * bodyLowerFullness;
  vec2 bodyEdgeNormal2 = bodyGrad;
  vec3 bodyDomeNormal = normalize(vec3(bodyP.x * 0.80 / (0.82 * 0.82), bodyP.y * 0.80 / (1.02 * 1.02), max(bodyRound, 0.18)));
  vec3 bodyRimNormal = normalize(vec3(bodyEdgeNormal2 * 1.25, 0.34));
  float bodyRimBlend = 1.0 - smoothstep(0.006, 0.105, bodyInnerLocal);
  vec3 bodyNormal = normalize(mix(bodyDomeNormal, bodyRimNormal, bodyRimBlend));

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 bodyLight3 = normalize(vec3(lightDir * 0.92, 0.54));
  float bodyDiffuse = clamp(dot(bodyNormal, bodyLight3), 0.0, 1.0);
  float bodyFacingLight = smoothstep(0.00, 0.88, bodyDiffuse);
  float bodyBackRim = smoothstep(0.66, -0.08, dot(bodyNormal, bodyLight3));
  float bodyFresnel = pow(clamp(1.0 - dot(bodyNormal, viewDir), 0.0, 1.0), 2.8);
  float bodySpec = pow(clamp(dot(reflect(-bodyLight3, bodyNormal), viewDir), 0.0, 1.0), 42.0);
  float bodyBroadSpec = pow(clamp(dot(reflect(-bodyLight3, bodyNormal), viewDir), 0.0, 1.0), 9.0);
  float bodyRefract = pow(clamp(dot(bodyNormal, normalize(vec3(-lightDir * 0.75, 0.58))), 0.0, 1.0), 3.2);

  // Prism thickness follows light proximity: thickest on the edge nearest the
  // off-screen spotlight.
  float bodyLightProximity = pow(bodyFacingLight, 1.35);
  float bodyEdgeFalloff = mix(1400.0, 92.0, bodyLightProximity);
  float bodyInnerFalloff = mix(480.0, 38.0, bodyLightProximity);
  float bodyCausticAOffset = mix(0.002, 0.016, bodyLightProximity);
  float bodyCausticBOffset = mix(0.004, 0.034, bodyLightProximity);
  float bodyCausticAFalloff = mix(1100.0, 92.0, bodyLightProximity);
  float bodyCausticBFalloff = mix(700.0, 54.0, bodyLightProximity);

  float bodyEdge = exp(-abs(bodyD) * bodyEdgeFalloff);
  float bodyInnerWall = exp(-bodyInner * bodyInnerFalloff) * bodyMask;
  float bodyCausticA = exp(-abs(bodyD + bodyCausticAOffset) * bodyCausticAFalloff) * bodyMask;
  float bodyCausticB = exp(-abs(bodyD + bodyCausticBOffset) * bodyCausticBFalloff) * bodyMask;
  float movingHotspot = screenBeam * centerFocus * bodyEdge;
  vec3 prismA = spectralEdge(dot(bodyNormal.xy, lightDir) * 0.42 + bodyLocalD * 1.8 + lightAngle * 0.08);
  vec3 prismB = spectralEdge(dot(bodyNormal.xy, vec2(-lightDir.y, lightDir.x)) * 0.52 - lightAngle * 0.06);

  float bodyInternalLight = bodyMask * bodyHeight * (0.08 + 0.46 * bodyDiffuse) * (0.55 + 0.45 * bodyRound);
  float lowerInternalBounce = exp(-dot((bodyP - vec2(-0.10, -0.34)) / vec2(0.62, 0.28), (bodyP - vec2(-0.10, -0.34)) / vec2(0.62, 0.28))) * bodyMask;
  float bodyWhiteSheet = smoothstep(0.20, -0.48, bodyP.y + 0.36 * bodyP.x + 0.05)
                       * smoothstep(1.02, 0.30, bodyS)
                       * bodyMask;
  float bodyWhiteCore = exp(-dot((bodyP - vec2(-0.16, -0.46)) / vec2(0.72, 0.34), (bodyP - vec2(-0.16, -0.46)) / vec2(0.72, 0.34))) * bodyMask;
  float bodyWhiteRefraction = (bodyWhiteSheet * 0.58 + bodyWhiteCore * 0.44) * (0.48 + 0.52 * bodyRefract);

  vec3 bodyFill = vec3(0.003, 0.005, 0.014);
  bodyFill += vec3(0.008, 0.014, 0.030) * n * bodyMask * surfaceTexture;
  bodyFill += vec3(0.030, 0.044, 0.085) * bodyInternalLight;
  bodyFill += vec3(0.92, 0.96, 1.00) * bodyWhiteRefraction * refractionStrength;
  bodyFill += vec3(0.94, 0.97, 1.00) * (bodySpec * 2.10 + bodyBroadSpec * 0.52) * bodyMask * specularStrength;
  bodyFill += vec3(0.72, 0.80, 1.00) * lowerInternalBounce * bodyRefract * 0.42 * refractionStrength;
  bodyFill += mix(prismA, lightColor, 0.24) * bodyRefract * bodyMask * (0.12 + 0.36 * bodyDiffuse);
  bodyFill += prismA * bodyEdge * (0.34 + 1.35 * bodyFacingLight + 0.55 * bodyFresnel);
  bodyFill += prismB * bodyInnerWall * (0.10 + 0.70 * bodyFacingLight);
  bodyFill += prismA * bodyCausticA * (0.16 + 0.55 * bodyFacingLight);
  bodyFill += prismB * bodyCausticB * (0.08 + 0.28 * bodyBackRim);
  bodyFill += lightColor * bodyEdge * bodyFacingLight * 1.45;
  bodyFill += lightColor * movingHotspot * 0.22;

  // Leaf uses the same rounded-volume model, with its own light direction
  // 180 degrees from the body light.
  vec2 leafLightDir = -lightDir;
  vec3 leafLightColor = mix(coolColor.rgb, warmColor.rgb, 0.5 + 0.5 * sin(lightAngle + colorPhase));
  leafLightColor = mix(vec3(0.95, 0.97, 1.0), leafLightColor, 0.28);
  vec2 leafP = p - vec2(0.20, 0.75);
  float leafInnerLocal = max(-leafLocalD, 0.0);
  float leafS = length(leafP / vec2(0.42, 0.22));
  float leafRound = pow(clamp(1.0 - leafS * leafS, 0.0, 1.0), 0.58);
  vec2 leafEdgeNormal2 = leafGrad;
  vec3 leafDomeNormal = normalize(vec3(leafP.x * 0.72 / (0.42 * 0.42), leafP.y * 0.72 / (0.22 * 0.22), max(leafRound, 0.22)));
  vec3 leafRimNormal = normalize(vec3(leafEdgeNormal2 * 1.18, 0.38));
  float leafRimBlend = 1.0 - smoothstep(0.004, 0.065, leafInnerLocal);
  vec3 leafNormal = normalize(mix(leafDomeNormal, leafRimNormal, leafRimBlend));
  vec3 leafLight3 = normalize(vec3(leafLightDir * 0.88, 0.62));
  float leafDiffuse = clamp(dot(leafNormal, leafLight3), 0.0, 1.0);
  float leafFacingLight = smoothstep(0.00, 0.88, leafDiffuse);
  float leafSpec = pow(clamp(dot(reflect(-leafLight3, leafNormal), viewDir), 0.0, 1.0), 46.0);
  float leafBroadSpec = pow(clamp(dot(reflect(-leafLight3, leafNormal), viewDir), 0.0, 1.0), 10.0);
  float leafRefract = pow(clamp(dot(leafNormal, normalize(vec3(-leafLightDir * 0.72, 0.62))), 0.0, 1.0), 3.0);
  float leafLightProximity = pow(leafFacingLight, 1.35);
  float leafEdge = exp(-abs(leafD) * mix(1500.0, 105.0, leafLightProximity));
  vec3 leafPrism = spectralEdge(dot(leafNormal.xy, leafLightDir) * 0.48 + leafLocalD * 1.6 + lightAngle * 0.08 + 0.5);
  float leafInternalLight = leafMask * (0.06 + 0.42 * leafDiffuse) * (0.45 + 0.55 * leafRound);
  float leafWhitePlate = exp(-dot((leafP - leafLightDir * 0.10) / vec2(0.34, 0.15), (leafP - leafLightDir * 0.10) / vec2(0.34, 0.15))) * leafMask;
  float leafWhiteRake = smoothstep(0.26, -0.08, leafP.y - 0.34 * leafP.x)
                      * smoothstep(0.96, 0.25, leafS)
                      * leafMask;
  float leafWhiteRefraction = (leafWhitePlate * 0.28 + leafWhiteRake * 0.16) * (0.32 + 0.42 * leafRefract);
  vec3 leafFill = vec3(0.003, 0.005, 0.014);
  leafFill += vec3(0.032, 0.045, 0.080) * leafInternalLight;
  leafFill += vec3(0.94, 0.97, 1.00) * leafWhiteRefraction * refractionStrength;
  leafFill += vec3(0.94, 0.97, 1.00) * (leafSpec * 0.80 + leafBroadSpec * 0.14) * leafMask * specularStrength;
  leafFill += mix(leafPrism, leafLightColor, 0.22) * leafRefract * leafMask * (0.08 + 0.22 * leafDiffuse);
  leafFill += leafPrism * leafEdge * (0.24 + 1.05 * leafFacingLight);
  leafFill += leafLightColor * leafEdge * leafFacingLight * 1.05;

  vec3 insideFill = mix(bodyFill, leafFill, leafMask);
  color = mix(color, insideFill, logoMask);

  // Bloom spills only from the lit glass edge/aura, following the orbiting
  // light instead of glowing uniformly.
  float outsidePrismProximity = exteriorLight * screenBeam;
  color += lightColor * exp(-outside * mix(290.0, 24.0, outsidePrismProximity)) * outsidePrismProximity * outsideMask * 0.34 * bloomIntensity;
  color += spectralEdge(dot(p, lightDir) * 0.22 + lightAngle * 0.06) * exp(-outside * mix(430.0, 36.0, outsidePrismProximity)) * outsidePrismProximity * outsideMask * 0.14 * bloomIntensity;

  // Darken corners; the reference background is nearly black.
  float vig = smoothstep(1.05, 0.20, vignetteR);
  color *= (1.0 - vignette * 0.38) + vignette * 0.38 * vig;

  color = 1.0 - exp(-color * 1.22 * exposure);
  color = pow(color, vec3(0.90));
  return vec4(color, 1.0);
}

void main(void) {
  loadOutlines();
  gl_FragColor = effect(gl_FragCoord.xy / iResolution.xy);
}
`;

// #rrggbb → normalised RGBA, matching the shader's vec4 colour uniforms.
function channelsOf(hex: string): [number, number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

const options = {
  speed: num(1, {label: "speed", min: 0, max: 5, step: 0.1}),
  orbitSpeed: num(1, {label: "orbit speed", min: 0, max: 5, step: 0.1}),
  orbitRadius: num(0.68, {label: "orbit radius", min: 0, max: 1.5, step: 0.01}),
  colorPhase: num(0.8, {label: "color phase", min: 0, max: 6.28, step: 0.01}),
  colorSaturation: num(0.34, {label: "color saturation", min: 0, max: 1, step: 0.01}),
  warmColor: color("#ff752e", {label: "warm color"}),
  coolColor: color("#38d1ff", {label: "cool color"}),
  neutralColor: color("#ebf5ff", {label: "neutral color"}),
  backgroundColor: color("#020205", {label: "background color"}),
  glowColor: color("#030410", {label: "glow color"}),
  glowIntensity: num(1, {label: "glow intensity", min: 0, max: 5, step: 0.1}),
  beamIntensity: num(1, {label: "beam intensity", min: 0, max: 3, step: 0.1}),
  bloomIntensity: num(1, {label: "bloom intensity", min: 0, max: 5, step: 0.1}),
  vignette: num(1, {label: "vignette", min: 0, max: 3, step: 0.1}),
  exposure: num(1, {label: "exposure", min: 0.2, max: 3, step: 0.05}),
  logoScale: num(0.2175, {label: "logo scale", min: 0.05, max: 0.6, step: 0.005}),
  offsetX: num(0, {label: "offset x", min: -1, max: 1, step: 0.01}),
  offsetY: num(-0.045, {label: "offset y", min: -1, max: 1, step: 0.01}),
  glassThickness: num(0.33, {label: "glass thickness", min: 0, max: 1, step: 0.01}),
  specularStrength: num(1, {label: "specular strength", min: 0, max: 4, step: 0.1}),
  refractionStrength: num(1, {label: "refraction strength", min: 0, max: 4, step: 0.1}),
  surfaceTexture: num(1, {label: "surface texture", min: 0, max: 4, step: 0.1}),
};

export default defineEffect({
  label: "Apple Logo",
  description: "Glowing glass Apple logo lit by an orbiting warm/cool spotlight.",
  options,
  create: (el, values) => createGlslEffect(el, {
    fragment: FRAGMENT_GLSL,
    values,
    toUniforms: (v) => ({
      orbitSpeed: v.orbitSpeed,
      orbitRadius: v.orbitRadius,
      colorPhase: v.colorPhase,
      colorSaturation: v.colorSaturation,
      warmColor: channelsOf(v.warmColor),
      coolColor: channelsOf(v.coolColor),
      neutralColor: channelsOf(v.neutralColor),
      backgroundColor: channelsOf(v.backgroundColor),
      glowColor: channelsOf(v.glowColor),
      glowIntensity: v.glowIntensity,
      beamIntensity: v.beamIntensity,
      bloomIntensity: v.bloomIntensity,
      vignette: v.vignette,
      exposure: v.exposure,
      logoScale: v.logoScale,
      offsetX: v.offsetX,
      offsetY: v.offsetY,
      glassThickness: v.glassThickness,
      specularStrength: v.specularStrength,
      refractionStrength: v.refractionStrength,
      surfaceTexture: v.surfaceTexture,
    }),
    // 1000/60: one speed unit = one shader-second at 60 fps (orbit ≈ 45 s).
    speedOf: (v) => v.speed * 1000 / 60,
  }),
});
