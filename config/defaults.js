module.exports = {
  // Penali diversifikacije — score raspon je 0–12
  // >12 = nikad isti na toj poziciji | relax mehanizam automatski popušta ako nema alternative
  penaltySameCategory    : 14,   // prev1 — nikad ista kategorija odmah iza (najvažniji)
  penaltySameColor       : 10,   // prev1 — boja je vizuelno najuočljivija
  penaltySameType        : 5,    // prev1 — tip (Žene/Muškarci) — stranica već alternira polove
  penaltyInLast2Category : 7,    // prev2 — jaka deterenca (ista kat. na pos. 1 i 3 je dosadno)
  penaltyInLast2Color    : 5,    // prev2
  penaltyInLast2Type     : 2,    // prev2
  penaltyInLast3Category : 3,    // prev3 — lagana deterenca
  penaltyInLast3Color    : 2,    // prev3
  penaltyInLast3Type     : 0.8,  // prev3
  penaltyInLast4Category : 1.5,  // prev4 — samo blago smanjuje šansu
  penaltyInLast4Color    : 1.0,
  penaltyInLast4Type     : 0.3,
  penaltyInLast5Category : 0.5,  // prev5 — gotovo zanemarivo
  penaltyInLast5Color    : 0.3,
  penaltyInLast5Type     : 0.1,
  relaxStep      : 0.80,
  minRelaxFactor : 0.20,
  enableLookahead  : true,
  lookaheadSample  : 25,
  lookaheadMinPool : 15,
  jitter        : 0.25,
  deterministic : false,
  treatMissingScoreAs: 0,
  womenType  : "Žene",
  menType    : "Muškarci",
  unisexType : "Unisex",
  girlsType  : "Djevojčice",
  boysType   : "Dječaci",
  babyType   : "Bebe",
  pageSize          : 24,
  womenAdultsPerPage: 9,
  menAdultsPerPage  : 9,
  girlsPerPage      : 2,
  boysPerPage       : 2,
  babiesPerPage     : 2,
  femaleAccessoriesPerPage : 0,
  maleAccessoriesPerPage   : 0,
  firstGender       : "auto",
  banTopN              : 24,
  bannedCategoriesTopN : ["Setovi", "Potkošulje"],
  sprinklerScoreValue: -1,
  accessoryCategories: [
    "Torbe","Ruksaci","Novčanici","Kaiševi","Neseseri",
    "Manžetne","Čarape","Pidžame","Kape","Donji veš","Veš","Peškiri",
  ],
  sprinklerCategoryOrder: [
    "Torbe","Ruksaci","Novčanici","Kaiševi","Neseseri",
    "Manžetne","Pidžame","Peškiri","Čarape","Donji veš","Veš","Kape",
  ],
  maxSameTypeRun    : 3,
  maxSameCategoryRun: 4,
  scoreWeightCategory : 0.65,
  scoreWeightVariants : 0.25,
  scoreWeightInventory: 0.10,
  categoryScores: {
    "Jakne"      : { Cold: 10, Mild: 6, Warm: 2,  Hot: 1  },
    "Dukserice"  : { Cold: 9,  Mild: 6, Warm: 2,  Hot: 1  },
    "Džemperi"   : { Cold: 10, Mild: 5, Warm: 1,  Hot: 1  },
    "Košulje"    : { Cold: 6,  Mild: 8, Warm: 7,  Hot: 6  },
    "Majice"     : { Cold: 3,  Mild: 7, Warm: 10, Hot: 10 },
    "Polo majice": { Cold: 3,  Mild: 7, Warm: 10, Hot: 10 },
    "Trenerke"   : { Cold: 8,  Mild: 6, Warm: 3,  Hot: 2  },
    "Šorcevi"    : { Cold: 1,  Mild: 5, Warm: 10, Hot: 10 },
    "Torbe"      : { Cold: 7,  Mild: 7, Warm: 8,  Hot: 8  },
  },
};
