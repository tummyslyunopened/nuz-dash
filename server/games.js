// Mainline games. `regions` are PokeAPI region names used for location autocomplete.
// `caps` are hardcore-nuzlocke level caps (gym/trial leader's ace, then champion).
// Community cap lists vary slightly by source, so caps are copied onto each run
// at creation and remain editable in the UI.
export const GAMES = [
  {
    id: 'red-blue', name: 'Red / Blue', gen: 1, regions: ['kanto'],
    caps: [
      { label: 'Brock', cap: 14 }, { label: 'Misty', cap: 21 }, { label: 'Lt. Surge', cap: 24 },
      { label: 'Erika', cap: 29 }, { label: 'Koga', cap: 43 }, { label: 'Sabrina', cap: 43 },
      { label: 'Blaine', cap: 47 }, { label: 'Giovanni', cap: 50 }, { label: 'Champion', cap: 65 }
    ]
  },
  {
    id: 'yellow', name: 'Yellow', gen: 1, regions: ['kanto'],
    caps: [
      { label: 'Brock', cap: 12 }, { label: 'Misty', cap: 21 }, { label: 'Lt. Surge', cap: 28 },
      { label: 'Erika', cap: 32 }, { label: 'Koga', cap: 50 }, { label: 'Sabrina', cap: 50 },
      { label: 'Blaine', cap: 48 }, { label: 'Giovanni', cap: 50 }, { label: 'Champion', cap: 65 }
    ]
  },
  {
    id: 'gold-silver', name: 'Gold / Silver', gen: 2, regions: ['johto', 'kanto'],
    caps: [
      { label: 'Falkner', cap: 9 }, { label: 'Bugsy', cap: 16 }, { label: 'Whitney', cap: 20 },
      { label: 'Morty', cap: 25 }, { label: 'Chuck', cap: 30 }, { label: 'Jasmine', cap: 35 },
      { label: 'Pryce', cap: 31 }, { label: 'Clair', cap: 40 }, { label: 'Champion', cap: 50 }
    ]
  },
  {
    id: 'crystal', name: 'Crystal', gen: 2, regions: ['johto', 'kanto'],
    caps: [
      { label: 'Falkner', cap: 9 }, { label: 'Bugsy', cap: 16 }, { label: 'Whitney', cap: 20 },
      { label: 'Morty', cap: 25 }, { label: 'Chuck', cap: 30 }, { label: 'Jasmine', cap: 35 },
      { label: 'Pryce', cap: 31 }, { label: 'Clair', cap: 40 }, { label: 'Champion', cap: 50 }
    ]
  },
  {
    id: 'ruby-sapphire', name: 'Ruby / Sapphire', gen: 3, regions: ['hoenn'],
    caps: [
      { label: 'Roxanne', cap: 15 }, { label: 'Brawly', cap: 18 }, { label: 'Wattson', cap: 23 },
      { label: 'Flannery', cap: 28 }, { label: 'Norman', cap: 31 }, { label: 'Winona', cap: 33 },
      { label: 'Tate & Liza', cap: 42 }, { label: 'Wallace', cap: 43 }, { label: 'Champion', cap: 58 }
    ]
  },
  {
    id: 'emerald', name: 'Emerald', gen: 3, regions: ['hoenn'],
    caps: [
      { label: 'Roxanne', cap: 15 }, { label: 'Brawly', cap: 19 }, { label: 'Wattson', cap: 24 },
      { label: 'Flannery', cap: 29 }, { label: 'Norman', cap: 31 }, { label: 'Winona', cap: 33 },
      { label: 'Tate & Liza', cap: 42 }, { label: 'Juan', cap: 46 }, { label: 'Champion', cap: 58 }
    ]
  },
  {
    id: 'firered-leafgreen', name: 'FireRed / LeafGreen', gen: 3, regions: ['kanto'],
    caps: [
      { label: 'Brock', cap: 14 }, { label: 'Misty', cap: 21 }, { label: 'Lt. Surge', cap: 24 },
      { label: 'Erika', cap: 29 }, { label: 'Koga', cap: 43 }, { label: 'Sabrina', cap: 43 },
      { label: 'Blaine', cap: 47 }, { label: 'Giovanni', cap: 50 }, { label: 'Champion', cap: 63 }
    ]
  },
  {
    id: 'diamond-pearl', name: 'Diamond / Pearl', gen: 4, regions: ['sinnoh'],
    caps: [
      { label: 'Roark', cap: 14 }, { label: 'Gardenia', cap: 22 }, { label: 'Maylene', cap: 30 },
      { label: 'Crasher Wake', cap: 33 }, { label: 'Fantina', cap: 36 }, { label: 'Byron', cap: 39 },
      { label: 'Candice', cap: 44 }, { label: 'Volkner', cap: 49 }, { label: 'Champion', cap: 66 }
    ]
  },
  {
    id: 'platinum', name: 'Platinum', gen: 4, regions: ['sinnoh'],
    caps: [
      { label: 'Roark', cap: 14 }, { label: 'Gardenia', cap: 22 }, { label: 'Fantina', cap: 26 },
      { label: 'Maylene', cap: 32 }, { label: 'Crasher Wake', cap: 37 }, { label: 'Byron', cap: 41 },
      { label: 'Candice', cap: 44 }, { label: 'Volkner', cap: 49 }, { label: 'Champion', cap: 62 }
    ]
  },
  {
    id: 'heartgold-soulsilver', name: 'HeartGold / SoulSilver', gen: 4, regions: ['johto', 'kanto'],
    caps: [
      { label: 'Falkner', cap: 13 }, { label: 'Bugsy', cap: 17 }, { label: 'Whitney', cap: 19 },
      { label: 'Morty', cap: 25 }, { label: 'Chuck', cap: 31 }, { label: 'Jasmine', cap: 35 },
      { label: 'Pryce', cap: 34 }, { label: 'Clair', cap: 41 }, { label: 'Champion', cap: 50 }
    ]
  },
  {
    id: 'black-white', name: 'Black / White', gen: 5, regions: ['unova'],
    caps: [
      { label: 'Striaton Trio', cap: 14 }, { label: 'Lenora', cap: 20 }, { label: 'Burgh', cap: 23 },
      { label: 'Elesa', cap: 27 }, { label: 'Clay', cap: 31 }, { label: 'Skyla', cap: 35 },
      { label: 'Brycen', cap: 39 }, { label: 'Drayden / Iris', cap: 43 }, { label: 'Ghetsis', cap: 54 }
    ]
  },
  {
    id: 'black2-white2', name: 'Black 2 / White 2', gen: 5, regions: ['unova'],
    caps: [
      { label: 'Cheren', cap: 13 }, { label: 'Roxie', cap: 18 }, { label: 'Burgh', cap: 24 },
      { label: 'Elesa', cap: 30 }, { label: 'Clay', cap: 31 }, { label: 'Skyla', cap: 39 },
      { label: 'Drayden', cap: 46 }, { label: 'Marlon', cap: 51 }, { label: 'Champion', cap: 59 }
    ]
  },
  {
    id: 'x-y', name: 'X / Y', gen: 6, regions: ['kalos'],
    caps: [
      { label: 'Viola', cap: 12 }, { label: 'Grant', cap: 25 }, { label: 'Korrina', cap: 32 },
      { label: 'Ramos', cap: 34 }, { label: 'Clemont', cap: 37 }, { label: 'Valerie', cap: 42 },
      { label: 'Olympia', cap: 48 }, { label: 'Wulfric', cap: 59 }, { label: 'Champion', cap: 68 }
    ]
  },
  {
    id: 'omega-ruby-alpha-sapphire', name: 'Omega Ruby / Alpha Sapphire', gen: 6, regions: ['hoenn'],
    caps: [
      { label: 'Roxanne', cap: 14 }, { label: 'Brawly', cap: 18 }, { label: 'Wattson', cap: 23 },
      { label: 'Flannery', cap: 28 }, { label: 'Norman', cap: 31 }, { label: 'Winona', cap: 35 },
      { label: 'Tate & Liza', cap: 45 }, { label: 'Wallace', cap: 46 }, { label: 'Champion', cap: 59 }
    ]
  },
  {
    id: 'sun-moon', name: 'Sun / Moon', gen: 7, regions: ['alola'],
    caps: [
      { label: 'Totem Gumshoos', cap: 12 }, { label: 'Hala', cap: 15 }, { label: 'Totem Wishiwashi', cap: 20 },
      { label: 'Totem Lurantis', cap: 24 }, { label: 'Olivia', cap: 27 }, { label: 'Totem Mimikyu', cap: 33 },
      { label: 'Nanu', cap: 43 }, { label: 'Hapu', cap: 47 }, { label: 'Champion', cap: 63 }
    ]
  },
  {
    id: 'ultra-sun-ultra-moon', name: 'Ultra Sun / Ultra Moon', gen: 7, regions: ['alola'],
    caps: [
      { label: 'Totem Gumshoos', cap: 12 }, { label: 'Hala', cap: 16 }, { label: 'Totem Araquanid', cap: 20 },
      { label: 'Totem Lurantis', cap: 25 }, { label: 'Olivia', cap: 28 }, { label: 'Totem Mimikyu', cap: 33 },
      { label: 'Nanu', cap: 44 }, { label: 'Hapu', cap: 47 }, { label: 'Champion', cap: 63 }
    ]
  },
  {
    id: 'lets-go', name: "Let's Go Pikachu / Eevee", gen: 7, regions: ['kanto'],
    caps: [
      { label: 'Brock', cap: 12 }, { label: 'Misty', cap: 19 }, { label: 'Lt. Surge', cap: 25 },
      { label: 'Erika', cap: 29 }, { label: 'Koga', cap: 43 }, { label: 'Sabrina', cap: 43 },
      { label: 'Blaine', cap: 47 }, { label: 'Giovanni', cap: 50 }, { label: 'Champion', cap: 57 }
    ]
  },
  {
    id: 'sword-shield', name: 'Sword / Shield', gen: 8, regions: ['galar'],
    caps: [
      { label: 'Milo', cap: 20 }, { label: 'Nessa', cap: 23 }, { label: 'Kabu', cap: 27 },
      { label: 'Bea / Allister', cap: 36 }, { label: 'Opal', cap: 38 }, { label: 'Gordie / Melony', cap: 42 },
      { label: 'Piers', cap: 45 }, { label: 'Raihan', cap: 48 }, { label: 'Champion', cap: 65 }
    ]
  },
  {
    id: 'brilliant-diamond-shining-pearl', name: 'Brilliant Diamond / Shining Pearl', gen: 8, regions: ['sinnoh'],
    caps: [
      { label: 'Roark', cap: 14 }, { label: 'Gardenia', cap: 22 }, { label: 'Maylene', cap: 30 },
      { label: 'Crasher Wake', cap: 33 }, { label: 'Fantina', cap: 36 }, { label: 'Byron', cap: 39 },
      { label: 'Candice', cap: 44 }, { label: 'Volkner', cap: 49 }, { label: 'Champion', cap: 66 }
    ]
  },
  {
    id: 'legends-arceus', name: 'Legends: Arceus', gen: 8, regions: ['hisui'],
    caps: []
  },
  {
    id: 'scarlet-violet', name: 'Scarlet / Violet', gen: 9, regions: ['paldea'],
    caps: [
      { label: 'Katy', cap: 15 }, { label: 'Brassius', cap: 17 }, { label: 'Iono', cap: 24 },
      { label: 'Kofu', cap: 30 }, { label: 'Larry', cap: 36 }, { label: 'Ryme', cap: 42 },
      { label: 'Tulip', cap: 45 }, { label: 'Grusha', cap: 48 }, { label: 'Champion', cap: 62 }
    ]
  }
]
