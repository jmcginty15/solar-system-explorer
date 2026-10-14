#!/usr/bin/env python3
"""OPTIONAL offline tool: build a browser Type-9 aggregate SPK.

The app no longer loads a runtime BSP in the browser. Ephemeris comes from the
FastAPI + spiceypy server (`server/`) using the full downloaded kernels.

This script remains available if you need a standalone Type-9 kernel for
experiments; it is not required to run the explorer.

Requires spiceypy (`pip install spiceypy`). Sampling cadence is derived from
each body's orbital period about its natural center. After writing, every
segment is checked against the source kernels and the build fails on large
errors.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

try:
    import spiceypy as sp
except ImportError:
    print(
        "Missing dependency: spiceypy\n"
        "  python3 -m pip install spiceypy\n"
        "or, in a venv:\n"
        "  python3 -m venv .venv && source .venv/bin/activate && pip install spiceypy",
        file=sys.stderr,
    )
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1] / "public" / "kernels"
OUT = ROOT / "spk" / "runtime" / "bodies.bsp"
LSK = ROOT / "lsk" / "naif0012.tls"

BODIES: dict[str, tuple[int, int]] = {
    "sun": (10, 10),
    "mercury": (199, 199),
    "venus": (299, 299),
    "earth": (399, 399),
    "moon": (301, 301),
    "mars": (499, 499),
    "phobos": (401, 401),
    "deimos": (402, 402),
    "jupiter": (599, 599),
    "io": (501, 501),
    "europa": (502, 502),
    "ganymede": (503, 503),
    "callisto": (504, 504),
    "amalthea": (505, 505),
    "callirrhoe": (517, 517),
    "themisto": (518, 518),
    "himalia": (506, 506),
    "elara": (507, 507),
    "pasiphae": (508, 508),
    "sinope": (509, 509),
    "lysithea": (510, 510),
    "carme": (511, 511),
    "ananke": (512, 512),
    "leda": (513, 513),
    "megaclite": (519, 519),
    "taygete": (520, 520),
    "chaldene": (521, 521),
    "harpalyke": (522, 522),
    "kalyke": (523, 523),
    "iocaste": (524, 524),
    "erinome": (525, 525),
    "isonoe": (526, 526),
    "praxidike": (527, 527),
    "autonoe": (528, 528),
    "thyone": (529, 529),
    "hermippe": (530, 530),
    "aitne": (531, 531),
    "eurydome": (532, 532),
    "euanthe": (533, 533),
    "euporie": (534, 534),
    "orthosie": (535, 535),
    "sponde": (536, 536),
    "kale": (537, 537),
    "pasithee": (538, 538),
    "hegemone": (539, 539),
    "mneme": (540, 540),
    "aoede": (541, 541),
    "thelxinoe": (542, 542),
    "arche": (543, 543),
    "kallichore": (544, 544),
    "helike": (545, 545),
    "carpo": (546, 546),
    "eukelade": (547, 547),
    "cyllene": (548, 548),
    "kore": (549, 549),
    "herse": (550, 550),
    "s2010j1": (551, 551),
    "s2010j2": (552, 552),
    "s2010j3": (55531, 55531),
    "s2010j4": (55532, 55532),
    "s2010j5": (55533, 55533),
    "s2010j6": (55534, 55534),
    "dia": (553, 553),
    "s2016j1": (554, 554),
    "s2016j3": (55518, 55518),
    "s2016j4": (55519, 55519),
    "s2003j4": (55502, 55502),
    "s2003j9": (55503, 55503),
    "s2003j10": (55504, 55504),
    "s2003j12": (55505, 55505),
    "s2003j16": (55506, 55506),
    "s2003j18": (555, 555),
    "s2003j23": (55507, 55507),
    "s2003j24": (55508, 55508),
    "eirene": (557, 557),
    "philophrosyne": (558, 558),
    "s2017j1": (559, 559),
    "eupheme": (560, 560),
    "s2003j19": (561, 561),
    "valetudo": (562, 562),
    "s2017j2": (563, 563),
    "s2017j3": (564, 564),
    "pandia": (565, 565),
    "s2017j5": (566, 566),
    "s2017j6": (567, 567),
    "s2017j7": (568, 568),
    "s2017j8": (569, 569),
    "s2017j9": (570, 570),
    "ersa": (571, 571),
    "s2011j1": (572, 572),
    "s2003j2": (55501, 55501),
    "s2018j2": (55510, 55510),
    "s2018j3": (55511, 55511),
    "s2018j4": (55520, 55520),
    "s2018j5": (55528, 55528),
    "s2011j2": (556, 556),
    "s2011j3": (55509, 55509),
    "s2011j4": (55527, 55527),
    "s2011j5": (55530, 55530),
    "s2011j6": (55535, 55535),
    "s2021j1": (55512, 55512),
    "s2021j2": (55513, 55513),
    "s2021j3": (55514, 55514),
    "s2021j4": (55515, 55515),
    "s2021j5": (55516, 55516),
    "s2021j6": (55517, 55517),
    "s2021j7": (55543, 55543),
    "s2021j8": (55544, 55544),
    "s2022j1": (55521, 55521),
    "s2022j2": (55522, 55522),
    "s2022j3": (55523, 55523),
    "s2024j1": (55529, 55529),
    "s2017j10": (55525, 55525),
    "s2017j11": (55526, 55526),
    "s2017j12": (55536, 55536),
    "s2017j13": (55537, 55537),
    "s2017j14": (55538, 55538),
    "s2017j15": (55539, 55539),
    "s2017j16": (55540, 55540),
    "s2017j17": (55541, 55541),
    "s2017j18": (55542, 55542),
    "thebe": (514, 514),
    "adrastea": (515, 515),
    "metis": (516, 516),
    "saturn": (699, 699),
    "mimas": (601, 601),
    "enceladus": (602, 602),
    "tethys": (603, 603),
    "dione": (604, 604),
    "rhea": (605, 605),
    "titan": (606, 606),
    "hyperion": (607, 607),
    "iapetus": (608, 608),
    "phoebe": (609, 609),
    "ymir": (619, 619),
    "suttungr": (623, 623),
    "mundilfari": (625, 625),
    "skathi": (627, 627),
    "thrymr": (630, 630),
    "narvi": (631, 631),
    "aegir": (636, 636),
    "bergelmir": (638, 638),
    "bestla": (639, 639),
    "farbauti": (640, 640),
    "fenrir": (641, 641),
    "fornjot": (642, 642),
    "hati": (643, 643),
    "hyrrokkin": (644, 644),
    "kari": (645, 645),
    "loge": (646, 646),
    "skoll": (647, 647),
    "surtur": (648, 648),
    "jarnsaxa": (650, 650),
    "greip": (651, 651),
    "gridr": (654, 654),
    "angrboda": (655, 655),
    "skrymir": (656, 656),
    "gerd": (657, 657),
    "s2004s26": (658, 658),
    "eggther": (659, 659),
    "beli": (661, 661),
    "gunnlod": (662, 662),
    "thiazzi": (663, 663),
    "s2004s34": (664, 664),
    "alvaldi": (665, 665),
    "geirrod": (666, 666),
    "janus": (610, 610),
    "epimetheus": (611, 611),
    "helene": (612, 612),
    "telesto": (613, 613),
    "calypso": (614, 614),
    "atlas": (615, 615),
    "prometheus": (616, 616),
    "pandora": (617, 617),
    "pan": (618, 618),
    "methone": (632, 632),
    "pallene": (633, 633),
    "polydeuces": (634, 634),
    "daphnis": (635, 635),
    "anthe": (649, 649),
    "s2009s2": (65304, 65304),
    "aegaeon": (653, 653),
    "paaliaq": (620, 620),
    "ijiraq": (622, 622),
    "kiviuq": (624, 624),
    "siarnaq": (629, 629),
    "tarqeq": (652, 652),
    "tarvos": (621, 621),
    "albiorix": (626, 626),
    "erriapus": (628, 628),
    "bebhionn": (637, 637),
    "s2004s7": (65085, 65085),
    "s2004s12": (65086, 65086),
    "s2004s13": (65087, 65087),
    "s2004s17": (65088, 65088),
    "s2004s21": (65079, 65079),
    "s2004s24": (65070, 65070),
    "s2004s28": (65077, 65077),
    "s2004s29": (660, 660),
    "s2004s31": (65067, 65067),
    "s2004s36": (65081, 65081),
    "s2004s37": (65082, 65082),
    "s2004s39": (65084, 65084),
    "s2004s40": (65098, 65098),
    "s2004s41": (65104, 65104),
    "s2004s42": (65108, 65108),
    "s2004s43": (65111, 65111),
    "s2004s44": (65112, 65112),
    "s2004s45": (65113, 65113),
    "s2004s46": (65121, 65121),
    "s2004s47": (65123, 65123),
    "s2004s48": (65139, 65139),
    "s2004s49": (65141, 65141),
    "s2004s50": (65142, 65142),
    "s2004s51": (65150, 65150),
    "s2004s52": (65152, 65152),
    "s2004s53": (65154, 65154),
    "s2004s54": (65158, 65158),
    "s2004s55": (65159, 65159),
    "s2004s56": (65160, 65160),
    "s2004s57": (65161, 65161),
    "s2004s58": (65162, 65162),
    "s2004s59": (65163, 65163),
    "s2004s60": (65164, 65164),
    "s2004s61": (65165, 65165),
    "s2005s4": (65129, 65129),
    "s2005s5": (65135, 65135),
    "s2005s6": (65166, 65166),
    "s2005s7": (65167, 65167),
    "s2006s1": (65089, 65089),
    "s2006s3": (65090, 65090),
    "s2006s9": (65100, 65100),
    "s2006s10": (65109, 65109),
    "s2006s11": (65114, 65114),
    "s2006s12": (65115, 65115),
    "s2006s13": (65117, 65117),
    "s2006s14": (65125, 65125),
    "s2006s15": (65136, 65136),
    "s2006s16": (65137, 65137),
    "s2006s17": (65138, 65138),
    "s2006s18": (65143, 65143),
    "s2006s19": (65149, 65149),
    "s2006s20": (65157, 65157),
    "s2006s21": (65168, 65168),
    "s2006s22": (65169, 65169),
    "s2006s23": (65170, 65170),
    "s2006s24": (65171, 65171),
    "s2006s25": (65172, 65172),
    "s2006s26": (65173, 65173),
    "s2006s27": (65174, 65174),
    "s2006s28": (65175, 65175),
    "s2006s29": (65176, 65176),
    "s2007s2": (65091, 65091),
    "s2007s3": (65092, 65092),
    "s2007s5": (65101, 65101),
    "s2007s6": (65107, 65107),
    "s2007s7": (65130, 65130),
    "s2007s8": (65131, 65131),
    "s2007s9": (65153, 65153),
    "s2007s10": (65177, 65177),
    "s2007s11": (65178, 65178),
    "s2019s1": (65093, 65093),
    "s2019s2": (65094, 65094),
    "s2019s3": (65095, 65095),
    "s2019s4": (65103, 65103),
    "s2019s5": (65110, 65110),
    "s2019s6": (65116, 65116),
    "s2019s7": (65118, 65118),
    "s2019s8": (65119, 65119),
    "s2019s9": (65120, 65120),
    "s2019s10": (65122, 65122),
    "s2019s11": (65124, 65124),
    "s2019s12": (65126, 65126),
    "s2019s13": (65128, 65128),
    "s2019s14": (65133, 65133),
    "s2019s15": (65134, 65134),
    "s2019s16": (65144, 65144),
    "s2019s17": (65145, 65145),
    "s2019s18": (65146, 65146),
    "s2019s19": (65147, 65147),
    "s2019s20": (65148, 65148),
    "s2019s21": (65156, 65156),
    "s2019s22": (65179, 65179),
    "s2019s23": (65180, 65180),
    "s2019s24": (65181, 65181),
    "s2019s25": (65182, 65182),
    "s2019s26": (65183, 65183),
    "s2019s27": (65184, 65184),
    "s2019s28": (65185, 65185),
    "s2019s29": (65186, 65186),
    "s2019s30": (65187, 65187),
    "s2019s31": (65188, 65188),
    "s2019s32": (65189, 65189),
    "s2019s33": (65190, 65190),
    "s2019s34": (65191, 65191),
    "s2019s35": (65192, 65192),
    "s2019s36": (65193, 65193),
    "s2019s37": (65194, 65194),
    "s2019s38": (65195, 65195),
    "s2019s39": (65196, 65196),
    "s2019s40": (65197, 65197),
    "s2019s41": (65198, 65198),
    "s2019s42": (65199, 65199),
    "s2019s43": (65200, 65200),
    "s2019s44": (65201, 65201),
    "s2020s1": (65096, 65096),
    "s2020s2": (65097, 65097),
    "s2020s3": (65102, 65102),
    "s2020s4": (65105, 65105),
    "s2020s5": (65106, 65106),
    "s2020s6": (65127, 65127),
    "s2020s7": (65132, 65132),
    "s2020s8": (65140, 65140),
    "s2020s9": (65151, 65151),
    "s2020s10": (65155, 65155),
    "s2020s11": (65202, 65202),
    "s2020s12": (65203, 65203),
    "s2020s13": (65204, 65204),
    "s2020s14": (65205, 65205),
    "s2020s15": (65206, 65206),
    "s2020s16": (65207, 65207),
    "s2020s17": (65208, 65208),
    "s2020s18": (65209, 65209),
    "s2020s19": (65210, 65210),
    "s2020s20": (65211, 65211),
    "s2020s21": (65212, 65212),
    "s2020s22": (65213, 65213),
    "s2020s23": (65214, 65214),
    "s2020s24": (65215, 65215),
    "s2020s25": (65216, 65216),
    "s2020s26": (65217, 65217),
    "s2020s27": (65218, 65218),
    "s2020s28": (65219, 65219),
    "s2020s29": (65220, 65220),
    "s2020s30": (65221, 65221),
    "s2020s31": (65222, 65222),
    "s2020s32": (65223, 65223),
    "s2020s33": (65224, 65224),
    "s2020s34": (65225, 65225),
    "s2020s35": (65226, 65226),
    "s2020s36": (65227, 65227),
    "s2020s37": (65228, 65228),
    "s2020s38": (65229, 65229),
    "s2020s39": (65230, 65230),
    "s2020s40": (65231, 65231),
    "s2020s41": (65232, 65232),
    "s2020s42": (65233, 65233),
    "s2020s43": (65234, 65234),
    "s2020s44": (65235, 65235),
    "s2020s45": (65286, 65286),
    "s2020s46": (65287, 65287),
    "s2020s47": (65288, 65288),
    "s2020s48": (65289, 65289),
    "s2020s49": (65297, 65297),
    "s2023s1": (65236, 65236),
    "s2023s2": (65237, 65237),
    "s2023s3": (65238, 65238),
    "s2023s4": (65239, 65239),
    "s2023s5": (65240, 65240),
    "s2023s6": (65241, 65241),
    "s2023s7": (65242, 65242),
    "s2023s8": (65243, 65243),
    "s2023s9": (65244, 65244),
    "s2023s10": (65245, 65245),
    "s2023s11": (65246, 65246),
    "s2023s12": (65247, 65247),
    "s2023s13": (65248, 65248),
    "s2023s14": (65249, 65249),
    "s2023s15": (65250, 65250),
    "s2023s16": (65251, 65251),
    "s2023s17": (65252, 65252),
    "s2023s18": (65253, 65253),
    "s2023s19": (65254, 65254),
    "s2023s20": (65255, 65255),
    "s2023s21": (65256, 65256),
    "s2023s22": (65257, 65257),
    "s2023s23": (65258, 65258),
    "s2023s24": (65259, 65259),
    "s2023s25": (65260, 65260),
    "s2023s26": (65261, 65261),
    "s2023s27": (65262, 65262),
    "s2023s28": (65263, 65263),
    "s2023s29": (65264, 65264),
    "s2023s30": (65265, 65265),
    "s2023s31": (65266, 65266),
    "s2023s32": (65267, 65267),
    "s2023s33": (65268, 65268),
    "s2023s34": (65269, 65269),
    "s2023s35": (65270, 65270),
    "s2023s36": (65271, 65271),
    "s2023s37": (65272, 65272),
    "s2023s38": (65273, 65273),
    "s2023s39": (65274, 65274),
    "s2023s40": (65275, 65275),
    "s2023s41": (65276, 65276),
    "s2023s42": (65277, 65277),
    "s2023s43": (65278, 65278),
    "s2023s44": (65279, 65279),
    "s2023s45": (65280, 65280),
    "s2023s46": (65281, 65281),
    "s2023s47": (65282, 65282),
    "s2023s48": (65283, 65283),
    "s2023s49": (65284, 65284),
    "s2023s50": (65285, 65285),
    "s2023s51": (65290, 65290),
    "s2023s52": (65291, 65291),
    "s2023s53": (65292, 65292),
    "s2023s54": (65293, 65293),
    "s2023s55": (65294, 65294),
    "s2023s56": (65295, 65295),
    "s2023s57": (65296, 65296),
    "s2023s58": (65298, 65298),
    "s2023s59": (65299, 65299),
    "s2023s60": (65300, 65300),
    "s2023s61": (65301, 65301),
    "s2023s62": (65302, 65302),
    "s2023s63": (65303, 65303),
    "uranus": (799, 799),
    "ariel": (701, 701),
    "umbriel": (702, 702),
    "titania": (703, 703),
    "oberon": (704, 704),
    "miranda": (705, 705),
    "cordelia": (706, 706),
    "ophelia": (707, 707),
    "bianca": (708, 708),
    "cressida": (709, 709),
    "desdemona": (710, 710),
    "juliet": (711, 711),
    "portia": (712, 712),
    "rosalind": (713, 713),
    "belinda": (714, 714),
    "puck": (715, 715),
    "perdita": (725, 725),
    "mab": (726, 726),
    "cupid": (727, 727),
    "s2025u1": (75052, 75052),
    "francisco": (722, 722),
    "trinculo": (721, 721),
    "sycorax": (717, 717),
    "prospero": (718, 718),
    "setebos": (719, 719),
    "ferdinand": (724, 724),
    "margaret": (723, 723),
    "caliban": (716, 716),
    "stephano": (720, 720),
    "s2023u1": (75051, 75051),
    "neptune": (899, 899),
    "triton": (801, 801),
    "naiad": (803, 803),
    "thalassa": (804, 804),
    "despina": (805, 805),
    "galatea": (806, 806),
    "larissa": (807, 807),
    "proteus": (808, 808),
    "hippocamp": (814, 814),
    "nereid": (802, 802),
    "sao": (811, 811),
    "s2002n5": (85051, 85051),
    "laomedeia": (812, 812),
    "psamathe": (810, 810),
    "neso": (813, 813),
    "s2021n1": (85052, 85052),
    "halimede": (809, 809),
    "pluto": (999, 999),
    "charon": (901, 901),
    "nix": (902, 902),
    "hydra": (903, 903),
    "kerberos": (904, 904),
    "styx": (905, 905),
    "dysnomia": (120_136_199, 120_136_199),
    "hiiaka": (120_136_108, 120_136_108),
    "namaka": (220_136_108, 220_136_108),
    "weywot": (120_050_000, 120_050_000),
    "vanth": (120_090_482, 120_090_482),
    "actaea": (120_120_347, 120_120_347),
    "haunu": (120_469_705, 120_469_705),
    "ceres": (20_000_001, 2_000_001),
    "pallas": (20_000_002, 2_000_002),
    "vesta": (20_000_004, 2_000_004),
    "psyche": (20_000_016, 2_000_016),
    "lutetia": (20_000_021, 2_000_021),
    "kalliope": (20_000_022, 2_000_022),
    "eugenia": (20_000_045, 2_000_045),
    "sylvia": (20_000_087, 2_000_087),
    "antiope": (20_000_090, 2_000_090),
    "kleopatra": (20_000_216, 2_000_216),
    "ida": (20_000_243, 2_000_243),
    "mathilde": (20_000_253, 2_000_253),
    "eros": (20_000_433, 2_000_433),
    "davida": (20_000_511, 2_000_511),
    "icarus": (20_001_566, 2_001_566),
    "didymos": (20_065_803, 2_065_803),
    "dimorphos": (120_065_803, 120_065_803),
    "patroclus": (20_000_617, 20_000_617),
    "menoetius": (120_000_617, 120_000_617),
    "toutatis": (20_004_179, 2_004_179),
    "chariklo": (20_010_199, 20_010_199),
    "itokawa": (20_025_143, 2_025_143),
    "quaoar": (20_050_000, 20_050_000),
    "sedna": (20_090_377, 20_090_377),
    "orcus": (20_090_482, 20_090_482),
    "salacia": (20_120_347, 20_120_347),
    "kagara": (20_469_705, 20_469_705),
    "bennu": (2_101_955, 2_101_955),
    "ryugu": (20_162_173, 2_162_173),
    "arrokoth": (20_486_958, 20_486_958),
    "eris": (20_136_199, 2_136_199),
    "makemake": (20_136_472, 2_136_472),
    "haumea": (20_136_108, 2_136_108),
    "halley": (1_000_036, 1_000_036),
    "encke": (1_000_025, 1_000_025),
    "tempel1": (1_000_093, 1_000_093),
    "borrelly": (1_000_005, 1_000_005),
    "churyumovGerasimenko": (1_000_012, 1_000_012),
    "wild2": (1_000_107, 1_000_107),
    "hartley2": (1_000_041, 1_000_041),
    "haleBopp": (1_000_132, 1_000_132),
    "hyakutake": (1_000_131, 1_000_131),
    "sidingSpring": (1_003_228, 1_003_228),
    "lovejoy": (1_003_331, 1_003_331),
}

KERNELS = [
    "spk/de442s.bsp",
    "spk/mar099s.bsp",
    "spk/jup347.bsp",
    "spk/jup348.bsp",
    "spk/jup349.bsp",
    "spk/jup365.bsp",
    "spk/sat441.bsp",
    "spk/sat415.bsp",
    "spk/sat393_daphnis.bsp",
    "spk/sat455.bsp",
    "spk/sat457.bsp",
    "spk/sat459.bsp",
    "spk/sat480.bsp",
    "spk/nep097.bsp",
    "spk/nep098_part-1.bsp",
    "spk/nep098_part-2.bsp",
    "spk/plu060.bsp",
    "spk/ura184_part-1.bsp",
    "spk/ura184_part-2.bsp",
    "spk/ura184_part-3.bsp",
    "spk/ceres.bsp",
    "spk/pallas.bsp",
    "spk/vesta.bsp",
    "spk/psyche.bsp",
    "spk/lutetia.bsp",
    "spk/kalliope.bsp",
    "spk/eugenia.bsp",
    "spk/sylvia.bsp",
    "spk/antiope.bsp",
    "spk/kleopatra.bsp",
    "spk/ida.bsp",
    "spk/mathilde.bsp",
    "spk/eros.bsp",
    "spk/davida.bsp",
    "spk/icarus.bsp",
    "spk/didymos.bsp",
    "spk/dimorphos.bsp",
    "spk/patroclus.bsp",
    "spk/tnosat_patroclus.bsp",
    "spk/toutatis.bsp",
    "spk/chariklo.bsp",
    "spk/itokawa.bsp",
    "spk/quaoar.bsp",
    "spk/tnosat_quaoar.bsp",
    "spk/sedna.bsp",
    "spk/orcus.bsp",
    "spk/tnosat_orcus.bsp",
    "spk/tnosat_salacia.bsp",
    "spk/tnosat_kagara.bsp",
    "spk/bennu.bsp",
    "spk/ryugu.bsp",
    "spk/arrokoth.bsp",
    "spk/eris.bsp",
    "spk/tnosat_eris.bsp",
    "spk/makemake.bsp",
    "spk/haumea.bsp",
    "spk/tnosat_haumea.bsp",
    "spk/halley.bsp",
    "spk/encke.bsp",
    "spk/tempel1.bsp",
    "spk/borrelly.bsp",
    "spk/churyumovGerasimenko.bsp",
    "spk/wild2.bsp",
    "spk/hartley2.bsp",
    "spk/haleBopp.bsp",
    "spk/hyakutake.bsp",
    "spk/sidingSpring.bsp",
    "spk/lovejoy.bsp",
]

DEGREE = 7
# Type-9 windows need several samples per revolution; 32 ≈ 11° of mean anomaly.
SAMPLES_PER_ORBIT = 32
MIN_STEP_S = 5 * 60
MAX_STEP_S = 10 * 86400
# Bodies faster than this use the shorter 2000–2050 coverage window.
FAST_PERIOD_S = 40 * 86400
# Inner moons (P < 2 d) dominate Type-9 size; keep a near-term window so the
# browser-fetched runtime SPK stays under ~1 GB.
VERY_FAST_PERIOD_S = 2 * 86400
# Hard cap on samples per body (each sample is 6 doubles + epoch ≈ 56 B).
MAX_SAMPLES_PER_BODY = 100_000
# Absolute position error vs source kernels that fails the build.
MAX_VALIDATE_ERR_KM = 100.0
VALIDATE_EPOCHS = (
    "2000 JAN 01 TDB",
    "2010 JAN 01 TDB",
    "2020 JAN 01 TDB",
    "2026 SEP 30 TDB",
    "2030 JAN 01 TDB",
    "2040 JAN 01 TDB",
)


def coverage_et(body: int) -> tuple[float, float] | None:
    start = stop = None
    seen = False
    for i in range(sp.ktotal("spk")):
        file, _, _, _ = sp.kdata(i, "spk")
        try:
            ids = set(sp.spkobj(file))
        except Exception:
            continue
        if body not in ids:
            continue
        seen = True
        cover = sp.spkcov(file, body)
        for j in range(sp.wncard(cover)):
            a, b = sp.wnfetd(cover, j)
            start = a if start is None else min(start, a)
            stop = b if stop is None else max(stop, b)
    if not seen or start is None or stop is None:
        return None
    return start, stop


def orbital_center(naif_id: int) -> int | None:
    """NAIF ID of the natural motion center, or None for the Sun."""
    if naif_id == 10:
        return None
    if naif_id == 301:
        return 399
    if 401 <= naif_id <= 498:
        return 499
    if 501 <= naif_id <= 598:
        return 599
    if 601 <= naif_id <= 698:
        return 699
    if 701 <= naif_id <= 798:
        return 799
    # Provisional Uranian rocks in ura184 (S/2023 U1, S/2025 U1).
    if naif_id in (75051, 75052):
        return 799
    if 801 <= naif_id <= 898:
        return 899
    # Provisional Neptunian rocks in nep104 (S/2002 N5, S/2021 N1).
    if naif_id in (85051, 85052):
        return 899
    if 901 <= naif_id <= 998:
        return 999
    # Eris I Dysnomia (TNO satellite solution).
    if naif_id == 120_136_199:
        return 20_136_199
    # Haumea I Hi'iaka / II Namaka (TNO satellite solution).
    if naif_id in (120_136_108, 220_136_108):
        return 20_136_108
    # Quaoar I Weywot (TNO satellite solution).
    if naif_id == 120_050_000:
        return 20_050_000
    # (617) Patroclus I Menoetius (Trojan binary solution).
    if naif_id == 120_000_617:
        return 20_000_617
    # Orcus I Vanth (TNO satellite solution).
    if naif_id == 120_090_482:
        return 20_090_482
    # Salacia I Actaea (TNO satellite solution).
    if naif_id == 120_120_347:
        return 20_120_347
    # ǂKá̦gára I ǃHãunu (TNO satellite solution).
    if naif_id == 120_469_705:
        return 20_469_705
    # Planets, barycenters, asteroids, comets: heliocentric / SSB.
    return 0


def estimate_period_s(src_id: int, et: float) -> float | None:
    """Rough orbital period from r and |v| relative to the natural center."""
    center = orbital_center(src_id)
    if center is None:
        return None
    try:
        state, _ = sp.spkgeo(src_id, et, "J2000", center)
    except Exception:
        return None
    r = math.hypot(state[0], state[1], state[2])
    v = math.hypot(state[3], state[4], state[5])
    if r < 1.0 or v < 1e-12:
        return None
    return 2.0 * math.pi * r / v


def choose_step_s(src_id: int, et: float) -> tuple[float, float | None]:
    period = estimate_period_s(src_id, et)
    if period is None:
        return float(MAX_STEP_S), None
    step = period / SAMPLES_PER_ORBIT
    step = min(MAX_STEP_S, max(MIN_STEP_S, step))
    return step, period


def validate_runtime(
    written: list[tuple[str, int, int, float, float]],
) -> list[str]:
    """Compare runtime SPK states to source kernels; return failing body names."""
    sp.furnsh(str(OUT))
    failures: list[str] = []
    for name, src_id, out_id, et0, et1 in written:
        worst = 0.0
        worst_et = None
        for label in VALIDATE_EPOCHS:
            et = sp.str2et(label)
            if et < et0 or et > et1:
                continue
            try:
                truth, _ = sp.spkgeo(src_id, et, "J2000", 0)
                got, _ = sp.spkgeo(out_id, et, "J2000", 0)
            except Exception as exc:
                failures.append(name)
                print(f"VALIDATE FAIL {name}: {exc}")
                worst = None
                break
            err = math.hypot(
                got[0] - truth[0],
                got[1] - truth[1],
                got[2] - truth[2],
            )
            if err > worst:
                worst = err
                worst_et = label
        if worst is None:
            continue
        if worst > MAX_VALIDATE_ERR_KM:
            failures.append(name)
            print(
                f"VALIDATE FAIL {name}: max err {worst:.1f} km "
                f"at {worst_et} (limit {MAX_VALIDATE_ERR_KM} km)"
            )
        else:
            print(f"VALIDATE OK {name}: max err {worst:.3f} km")
    return failures


def main() -> int:
    if not LSK.exists():
        print(f"missing LSK: {LSK}", file=sys.stderr)
        return 1

    sp.kclear()
    sp.furnsh(str(LSK))
    for rel in KERNELS:
        path = ROOT / rel
        if not path.exists():
            print(f"missing kernel: {path}", file=sys.stderr)
            return 1
        print(f"furnsh {rel}")
        sp.furnsh(str(path))

    et_pref0 = sp.str2et("2000 JAN 01 TDB")
    et_pref1 = sp.str2et("2050 JAN 01 TDB")
    et_fast0 = sp.str2et("2020 JAN 01 TDB")
    et_fast1 = sp.str2et("2035 JAN 01 TDB")
    et_wide0 = sp.str2et("1950 JAN 01 TDB")
    et_wide1 = sp.str2et("2130 JAN 01 TDB")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    handle = sp.spkopn(str(OUT), "SSE runtime Type9 SSB states", 0)
    failed: list[str] = []
    written: list[tuple[str, int, int, float, float]] = []

    for name, (src_id, out_id) in BODIES.items():
        cov = coverage_et(src_id)
        if cov is None and name == "uranus":
            src_id = 7
            cov = coverage_et(src_id)
        if cov is None:
            print(f"SKIP {name}: no coverage")
            failed.append(name)
            continue

        cov0, cov1 = cov
        mid = 0.5 * (max(cov0, et_pref0) + min(cov1, et_pref1))
        step, period = choose_step_s(src_id, mid)

        if period is not None and period < VERY_FAST_PERIOD_S:
            et0, et1 = max(cov0, et_fast0), min(cov1, et_fast1)
        elif period is not None and period < FAST_PERIOD_S:
            et0, et1 = max(cov0, et_pref0), min(cov1, et_pref1)
        else:
            et0, et1 = max(cov0, et_wide0), min(cov1, et_wide1)

        if et1 - et0 < 86400 * 30:
            print(f"SKIP {name}: short coverage")
            failed.append(name)
            continue

        n = int(math.floor((et1 - et0) / step)) + 1
        if n < DEGREE + 2:
            step = (et1 - et0) / (DEGREE + 5)
            n = int(math.floor((et1 - et0) / step)) + 1
        if n > MAX_SAMPLES_PER_BODY:
            step = (et1 - et0) / (MAX_SAMPLES_PER_BODY - 1)
            n = MAX_SAMPLES_PER_BODY

        epochs = [et0 + i * step for i in range(n)]
        epochs[-1] = et1
        states: list[list[float]] = []
        try:
            for et in epochs:
                st, _ = sp.spkgeo(src_id, float(et), "J2000", 0)
                states.append(list(st))
        except Exception as exc:
            print(f"FAIL {name}: {exc}")
            failed.append(name)
            continue

        sp.spkw09(
            handle,
            out_id,
            0,
            "J2000",
            float(epochs[0]),
            float(epochs[-1]),
            f"{name}_SSB_T9"[:40],
            DEGREE,
            n,
            states,
            epochs,
        )
        period_txt = (
            f"P={period / 3600:.2f}h" if period is not None else "P=n/a"
        )
        print(
            f"OK {name}: n={n} step={step / 3600:.2f}h {period_txt}"
        )
        written.append((name, src_id, out_id, float(epochs[0]), float(epochs[-1])))

    sp.spkcls(handle)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB); write_failed={failed}")

    validate_failed = validate_runtime(written)
    if failed or validate_failed:
        print(
            f"BUILD FAILED write={failed} validate={validate_failed}",
            file=sys.stderr,
        )
        return 2
    print("BUILD OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
