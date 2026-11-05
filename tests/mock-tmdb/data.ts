// Testdaten für den TMDB-Testserver. Läuft nur in Tests und in der lokalen
// Design-Prüfung; die Anwendung selbst kennt diese Daten nicht.

export interface MockPerson {
  id: number;
  name: string;
  department: string;
  birthday?: string;
  place?: string;
  biography?: string;
}

export interface MockMovie {
  id: number;
  title: string;
  en: string;
  original?: string;
  date: string;
  runtime: number;
  genres: number[];
  keywords: number[];
  cast: number[];
  director: number[];
  vote: number;
  votes: number;
  popularity: number;
  collection?: number;
  overview?: string;
  overviewEn?: string;
  language?: string;
  certification?: string;
}

export interface MockSeason {
  number: number;
  episodes: number;
  /** Tage ab heute, an denen die erste Folge läuft; negativ liegt in der Vergangenheit. */
  startOffsetDays: number;
  stepDays?: number;
}

export interface MockSeries {
  id: number;
  title: string;
  en: string;
  date: string;
  runtime: number;
  genres: number[];
  keywords: number[];
  cast: number[];
  creator: number[];
  vote: number;
  votes: number;
  popularity: number;
  status: string;
  seasons: MockSeason[];
  overview: string;
}

export const GENRES = {
  movie: [
    [28, "Action"], [12, "Abenteuer"], [16, "Animation"], [35, "Komödie"], [80, "Krimi"], [99, "Dokumentarfilm"],
    [18, "Drama"], [10751, "Familie"], [14, "Fantasy"], [36, "Historie"], [27, "Horror"], [10402, "Musik"],
    [9648, "Mystery"], [10749, "Liebesfilm"], [878, "Science Fiction"], [53, "Thriller"], [10752, "Kriegsfilm"], [37, "Western"],
  ],
  tv: [
    [10759, "Action & Adventure"], [16, "Animation"], [35, "Komödie"], [80, "Krimi"], [18, "Drama"], [10765, "Sci-Fi & Fantasy"], [9648, "Mystery"],
  ],
} as const;

export const COLLECTIONS: Record<number, { name: string; overview: string }> = {
  1241: { name: "Harry Potter Filmreihe", overview: "Die acht Verfilmungen um den jungen Zauberer Harry Potter und seinen Kampf gegen Lord Voldemort." },
  119: { name: "Der Herr der Ringe Filmreihe", overview: "Die Reise der Gefährten durch Mittelerde, um den Einen Ring zu vernichten." },
  121938: { name: "Der Hobbit Filmreihe", overview: "Bilbo Beutlins Abenteuer mit Gandalf und den Zwergen." },
  435259: { name: "Phantastische Tierwesen Filmreihe", overview: "Newt Scamanders Abenteuer in der Zaubererwelt der 1920er Jahre." },
  10: { name: "Star Wars Filmreihe", overview: "Der Kampf zwischen Jedi und Sith in einer weit, weit entfernten Galaxis." },
};

const K = { magic: 1001, school: 1002, wizard: 1003, quest: 1004, ring: 1005, dystopia: 1006, dream: 1007, space: 1008, heist: 1009, hero: 1010, crime: 1011, family: 1012, drug: 1013, darkFantasy: 1014, dragon: 1015, monster: 1016, office: 1017, supernatural: 1018 };

export const KEYWORDS = Object.entries(K).map(([name, id]) => ({ id, name }));

export const PEOPLE: MockPerson[] = [
  { id: 10980, name: "Daniel Radcliffe", department: "Acting", birthday: "1989-07-23", place: "Fulham, London, England", biography: "Daniel Jacob Radcliffe ist ein britischer Schauspieler. Bekannt wurde er durch die Titelrolle in den Harry-Potter-Filmen, die ihn ab 2001 international berühmt machten. Danach spielte er unter anderem Theater am West End und am Broadway und wählte im Film ungewöhnliche Rollen." },
  { id: 10989, name: "Rupert Grint", department: "Acting", birthday: "1988-08-24", place: "Harlow, England" },
  { id: 10990, name: "Emma Watson", department: "Acting", birthday: "1990-04-15", place: "Paris, Frankreich" },
  { id: 4566, name: "Alan Rickman", department: "Acting", birthday: "1946-02-21", place: "London, England" },
  { id: 10978, name: "Maggie Smith", department: "Acting", birthday: "1934-12-28", place: "Ilford, England" },
  { id: 1327, name: "Ian McKellen", department: "Acting", birthday: "1939-05-25", place: "Burnley, England" },
  { id: 109, name: "Elijah Wood", department: "Acting", birthday: "1981-01-28", place: "Cedar Rapids, USA" },
  { id: 110, name: "Viggo Mortensen", department: "Acting", birthday: "1958-10-20", place: "New York City, USA" },
  { id: 114, name: "Orlando Bloom", department: "Acting", birthday: "1977-01-13", place: "Canterbury, England" },
  { id: 48, name: "Sean Bean", department: "Acting", birthday: "1959-04-17", place: "Sheffield, England" },
  { id: 37632, name: "Eddie Redmayne", department: "Acting", birthday: "1982-01-06", place: "London, England" },
  { id: 6193, name: "Leonardo DiCaprio", department: "Acting", birthday: "1974-11-11", place: "Los Angeles, USA" },
  { id: 3894, name: "Christian Bale", department: "Acting", birthday: "1974-01-30", place: "Haverfordwest, Wales" },
  { id: 6384, name: "Keanu Reeves", department: "Acting", birthday: "1964-09-02", place: "Beirut, Libanon" },
  { id: 1892, name: "Matt Damon", department: "Acting", birthday: "1970-10-08", place: "Cambridge, USA" },
  { id: 8, name: "Samuel L. Jackson", department: "Acting", birthday: "1948-12-21", place: "Washington, USA" },
  { id: 17419, name: "Bryan Cranston", department: "Acting", birthday: "1956-03-07", place: "Hollywood, USA" },
  { id: 84497, name: "Aaron Paul", department: "Acting", birthday: "1979-08-27", place: "Emmett, USA" },
  { id: 239019, name: "Emilia Clarke", department: "Acting", birthday: "1986-10-23", place: "London, England" },
  { id: 1223786, name: "Adam Scott", department: "Acting", birthday: "1973-04-03", place: "Santa Cruz, USA" },
  { id: 10965, name: "Chris Columbus", department: "Directing", birthday: "1958-09-10" },
  { id: 11218, name: "Alfonso Cuarón", department: "Directing", birthday: "1961-11-28" },
  { id: 10723, name: "Mike Newell", department: "Directing", birthday: "1942-03-28" },
  { id: 11343, name: "David Yates", department: "Directing", birthday: "1963-10-08" },
  { id: 108, name: "Peter Jackson", department: "Directing", birthday: "1961-10-31", place: "Wellington, Neuseeland" },
  { id: 525, name: "Christopher Nolan", department: "Directing", birthday: "1970-07-30", place: "London, England" },
  { id: 9339, name: "Lana Wachowski", department: "Directing", birthday: "1965-06-21" },
  { id: 138, name: "Quentin Tarantino", department: "Directing", birthday: "1963-03-27" },
  { id: 608, name: "Hayao Miyazaki", department: "Directing", birthday: "1941-01-05", place: "Tokio, Japan" },
  { id: 21684, name: "Bong Joon-ho", department: "Directing", birthday: "1969-09-14" },
  { id: 66633, name: "Vince Gilligan", department: "Writing", birthday: "1967-02-10" },
  { id: 9813, name: "David Benioff", department: "Writing", birthday: "1970-09-25" },
  { id: 1179419, name: "Dan Erickson", department: "Writing" },
  { id: 1151, name: "Matt Duffer", department: "Writing" },
];

const HP_CAST = [10980, 10989, 10990, 4566, 10978];
const HP_KW = [K.magic, K.school, K.wizard, K.darkFantasy];
const HP_GENRES = [12, 14];
const LOTR_CAST = [109, 1327, 110, 114, 48];
const LOTR_KW = [K.quest, K.ring, K.wizard, K.darkFantasy];
const LOTR_GENRES = [12, 14, 28];

export const MOVIES: MockMovie[] = [
  { id: 671, title: "Harry Potter und der Stein der Weisen", en: "Harry Potter and the Philosopher's Stone", date: "2001-11-16", runtime: 152, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [10965], vote: 7.9, votes: 28000, popularity: 180, collection: 1241, certification: "6", overview: "Harry Potter wächst bei Verwandten auf, die ihn schlecht behandeln. An seinem elften Geburtstag erfährt er, dass er ein Zauberer ist, und erhält einen Platz an der Hogwarts-Schule für Hexerei und Zauberei. Dort findet er in Ron und Hermine echte Freunde, lernt das Fliegen auf dem Besen und stösst auf das Geheimnis eines verborgenen Steins, den ein dunkler Zauberer um jeden Preis in seinen Besitz bringen will." },
  { id: 672, title: "Harry Potter und die Kammer des Schreckens", en: "Harry Potter and the Chamber of Secrets", date: "2002-11-13", runtime: 161, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [10965], vote: 7.7, votes: 22000, popularity: 150, collection: 1241, certification: "6", overview: "Im zweiten Schuljahr öffnet jemand die sagenumwobene Kammer des Schreckens." },
  { id: 673, title: "Harry Potter und der Gefangene von Askaban", en: "Harry Potter and the Prisoner of Azkaban", date: "2004-05-31", runtime: 141, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [11218], vote: 8.0, votes: 23000, popularity: 170, collection: 1241, certification: "6", overview: "Der gefährliche Häftling Sirius Black ist aus Askaban ausgebrochen und scheint es auf Harry abgesehen zu haben." },
  { id: 674, title: "Harry Potter und der Feuerkelch", en: "Harry Potter and the Goblet of Fire", date: "2005-11-16", runtime: 157, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [10723], vote: 7.8, votes: 21000, popularity: 140, collection: 1241, certification: "12", overview: "Harry wird auf rätselhafte Weise als vierter Teilnehmer für das Trimagische Turnier ausgewählt." },
  { id: 675, title: "Harry Potter und der Orden des Phönix", en: "Harry Potter and the Order of the Phoenix", date: "2007-06-28", runtime: 138, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [11343], vote: 7.7, votes: 19000, popularity: 130, collection: 1241, certification: "12", overview: "Das Ministerium leugnet Voldemorts Rückkehr, und Harry gründet eine geheime Gruppe." },
  { id: 767, title: "Harry Potter und der Halbblutprinz", en: "Harry Potter and the Half-Blood Prince", date: "2009-07-07", runtime: 153, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [11343], vote: 7.7, votes: 19500, popularity: 128, collection: 1241, certification: "12", overview: "Harry findet ein altes Schulbuch mit den Notizen eines geheimnisvollen Halbblutprinzen." },
  { id: 12444, title: "Harry Potter und die Heiligtümer des Todes 1", en: "Harry Potter and the Deathly Hallows: Part 1", date: "2010-10-17", runtime: 146, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [11343], vote: 7.8, votes: 20000, popularity: 135, collection: 1241, certification: "12", overview: "Harry, Ron und Hermine machen sich auf die Suche nach den Horkruxen." },
  { id: 12445, title: "Harry Potter und die Heiligtümer des Todes 2", en: "Harry Potter and the Deathly Hallows: Part 2", date: "2011-07-12", runtime: 130, genres: HP_GENRES, keywords: HP_KW, cast: HP_CAST, director: [11343], vote: 8.1, votes: 21500, popularity: 160, collection: 1241, certification: "12", overview: "Die letzte Schlacht um Hogwarts beginnt." },

  { id: 120, title: "Der Herr der Ringe: Die Gefährten", en: "The Lord of the Rings: The Fellowship of the Ring", date: "2001-12-18", runtime: 179, genres: LOTR_GENRES, keywords: LOTR_KW, cast: LOTR_CAST, director: [108], vote: 8.4, votes: 25000, popularity: 150, collection: 119, certification: "12", overview: "Der Hobbit Frodo erbt einen Ring von ungeheurer Macht und bricht auf, um ihn zu vernichten." },
  { id: 121, title: "Der Herr der Ringe: Die zwei Türme", en: "The Lord of the Rings: The Two Towers", date: "2002-12-18", runtime: 179, genres: LOTR_GENRES, keywords: LOTR_KW, cast: LOTR_CAST, director: [108], vote: 8.4, votes: 22000, popularity: 130, collection: 119, certification: "12", overview: "Die Gefährten sind getrennt, und Saruman rüstet zum Krieg." },
  { id: 122, title: "Der Herr der Ringe: Die Rückkehr des Königs", en: "The Lord of the Rings: The Return of the King", date: "2003-12-01", runtime: 201, genres: LOTR_GENRES, keywords: LOTR_KW, cast: LOTR_CAST, director: [108], vote: 8.5, votes: 24000, popularity: 145, collection: 119, certification: "12", overview: "Frodo erreicht den Schicksalsberg, während Gondor vor der entscheidenden Schlacht steht." },
  { id: 49051, title: "Der Hobbit: Eine unerwartete Reise", en: "The Hobbit: An Unexpected Journey", date: "2012-12-12", runtime: 169, genres: LOTR_GENRES, keywords: [K.quest, K.wizard, K.dragon], cast: [1327, 109], director: [108], vote: 7.4, votes: 18000, popularity: 110, collection: 121938, certification: "12", overview: "Bilbo Beutlin lässt sich auf ein Abenteuer mit Gandalf und dreizehn Zwergen ein." },
  { id: 57158, title: "Der Hobbit: Smaugs Einöde", en: "The Hobbit: The Desolation of Smaug", date: "2013-12-11", runtime: 161, genres: LOTR_GENRES, keywords: [K.quest, K.dragon], cast: [1327, 114], director: [108], vote: 7.6, votes: 16000, popularity: 100, collection: 121938, certification: "12", overview: "Die Gemeinschaft erreicht den Einsamen Berg und den Drachen Smaug." },
  { id: 122917, title: "Der Hobbit: Die Schlacht der Fünf Heere", en: "The Hobbit: The Battle of the Five Armies", date: "2014-12-10", runtime: 144, genres: LOTR_GENRES, keywords: [K.quest, K.dragon], cast: [1327, 114], director: [108], vote: 7.3, votes: 15000, popularity: 95, collection: 121938, certification: "12", overview: "Fünf Heere ziehen um den Einsamen Berg in die Schlacht." },
  { id: 259316, title: "Phantastische Tierwesen und wo sie zu finden sind", en: "Fantastic Beasts and Where to Find Them", date: "2016-11-16", runtime: 133, genres: HP_GENRES, keywords: [K.magic, K.wizard, K.monster], cast: [37632], director: [11343], vote: 7.3, votes: 19000, popularity: 90, collection: 435259, certification: "12", overview: "Newt Scamander kommt mit einem Koffer voller magischer Geschöpfe nach New York." },
  { id: 338952, title: "Phantastische Tierwesen: Grindelwalds Verbrechen", en: "Fantastic Beasts: The Crimes of Grindelwald", date: "2018-11-14", runtime: 134, genres: HP_GENRES, keywords: [K.magic, K.wizard], cast: [37632], director: [11343], vote: 6.8, votes: 12000, popularity: 75, collection: 435259, certification: "12", overview: "Grindelwald entkommt und sammelt Anhänger." },

  { id: 338953, title: "Phantastische Tierwesen: Dumbledores Geheimnisse", en: "Fantastic Beasts: The Secrets of Dumbledore", date: "2022-04-06", runtime: 142, genres: HP_GENRES, keywords: [K.magic, K.wizard], cast: [37632], director: [11343], vote: 6.7, votes: 5000, popularity: 60, collection: 435259, certification: "12", overview: "Dumbledore schickt Newt Scamander und seine Gefährten gegen Grindelwald ins Feld." },

  { id: 411, title: "Die Chroniken von Narnia: Der König von Narnia", en: "The Chronicles of Narnia: The Lion, the Witch and the Wardrobe", date: "2005-12-07", runtime: 143, genres: [12, 10751, 14], keywords: [K.magic, K.quest, K.family], cast: [], director: [], vote: 7.1, votes: 10500, popularity: 80, overview: "Vier Geschwister finden durch einen Kleiderschrank den Weg in ein verwunschenes Land." },
  { id: 2270, title: "Der Sternwanderer", en: "Stardust", date: "2007-08-10", runtime: 127, genres: [12, 14, 10749], keywords: [K.magic, K.quest], cast: [1327], director: [], vote: 7.5, votes: 3900, popularity: 45, overview: "Ein junger Mann sucht einen gefallenen Stern und gerät in ein magisches Königreich." },
  { id: 2493, title: "Die Braut des Prinzen", en: "The Princess Bride", date: "1987-09-25", runtime: 98, genres: [12, 10751, 14, 35, 10749], keywords: [K.quest, K.family], cast: [], director: [], vote: 7.7, votes: 5400, popularity: 40, overview: "Ein Grossvater liest seinem Enkel die Geschichte einer grossen Liebe vor." },
  { id: 1417, title: "Pans Labyrinth", en: "Pan's Labyrinth", date: "2006-10-11", runtime: 118, genres: [14, 18, 10752], keywords: [K.darkFantasy, K.monster], cast: [], director: [], vote: 7.8, votes: 11000, popularity: 42, language: "es", overview: "Im Spanien von 1944 flüchtet sich ein Mädchen in eine düstere Märchenwelt." },
  { id: 129, title: "Chihiros Reise ins Zauberland", en: "Spirited Away", original: "千と千尋の神隠し", date: "2001-07-20", runtime: 125, genres: [16, 10751, 14], keywords: [K.magic, K.family], cast: [], director: [608], vote: 8.5, votes: 17000, popularity: 88, language: "ja", overview: "Die zehnjährige Chihiro gerät in eine Welt der Geister und muss dort arbeiten, um ihre Eltern zu retten." },
  { id: 128, title: "Prinzessin Mononoke", en: "Princess Mononoke", original: "もののけ姫", date: "1997-07-12", runtime: 134, genres: [12, 14, 16], keywords: [K.monster, K.quest], cast: [], director: [608], vote: 8.3, votes: 8600, popularity: 55, language: "ja", overview: "Ein junger Krieger gerät in den Kampf zwischen den Waldgöttern und den Menschen." },
  { id: 27205, title: "Inception", en: "Inception", date: "2010-07-15", runtime: 148, genres: [28, 878, 12], keywords: [K.dream, K.heist], cast: [6193], director: [525], vote: 8.4, votes: 36000, popularity: 120, overview: "Ein Dieb stiehlt Geheimnisse aus Träumen und soll nun einen Gedanken einpflanzen." },
  { id: 157336, title: "Interstellar", en: "Interstellar", date: "2014-11-05", runtime: 169, genres: [12, 18, 878], keywords: [K.space], cast: [1892], director: [525], vote: 8.5, votes: 35000, popularity: 150, overview: "Eine Gruppe Raumfahrer sucht jenseits unserer Galaxis eine neue Heimat für die Menschheit." },
  { id: 155, title: "The Dark Knight", en: "The Dark Knight", date: "2008-07-16", runtime: 152, genres: [18, 28, 80, 53], keywords: [K.hero, K.crime], cast: [3894], director: [525], vote: 8.5, votes: 32000, popularity: 125, overview: "Batman stellt sich dem Joker, der Gotham in Chaos stürzen will." },
  { id: 603, title: "Matrix", en: "The Matrix", date: "1999-03-31", runtime: 136, genres: [28, 878], keywords: [K.dystopia], cast: [6384], director: [9339], vote: 8.2, votes: 26000, popularity: 105, overview: "Ein Programmierer erfährt, dass die Welt eine Simulation ist." },
  { id: 680, title: "Pulp Fiction", en: "Pulp Fiction", date: "1994-09-10", runtime: 154, genres: [53, 80], keywords: [K.crime], cast: [8], director: [138], vote: 8.5, votes: 28000, popularity: 90, overview: "Mehrere Geschichten aus der Unterwelt von Los Angeles greifen ineinander." },
  { id: 278, title: "Die Verurteilten", en: "The Shawshank Redemption", date: "1994-09-23", runtime: 142, genres: [18, 80], keywords: [K.crime], cast: [], director: [], vote: 8.7, votes: 28000, popularity: 100, overview: "Ein zu Unrecht Verurteilter findet im Gefängnis Freundschaft und Hoffnung." },
  { id: 238, title: "Der Pate", en: "The Godfather", date: "1972-03-14", runtime: 175, genres: [18, 80], keywords: [K.crime, K.family], cast: [], director: [], vote: 8.7, votes: 21000, popularity: 95, overview: "Der Patriarch einer Mafiafamilie übergibt die Geschäfte an seinen Sohn." },
  { id: 496243, title: "Parasite", en: "Parasite", original: "기생충", date: "2019-05-30", runtime: 133, genres: [35, 53, 18], keywords: [K.family, K.crime], cast: [], director: [21684], vote: 8.5, votes: 19000, popularity: 85, language: "ko", overview: "Eine arme Familie schleicht sich bei einer reichen ein." },
  { id: 11, title: "Star Wars: Eine neue Hoffnung", en: "Star Wars", date: "1977-05-25", runtime: 121, genres: [12, 28, 878], keywords: [K.space, K.hero], cast: [], director: [], vote: 8.2, votes: 21000, popularity: 90, collection: 10, overview: "Der junge Luke Skywalker schliesst sich dem Kampf gegen das Imperium an." },
  { id: 1891, title: "Das Imperium schlägt zurück", en: "The Empire Strikes Back", date: "1980-05-20", runtime: 124, genres: [12, 28, 878], keywords: [K.space, K.hero], cast: [], director: [], vote: 8.4, votes: 17000, popularity: 70, collection: 10, overview: "Die Rebellen sind auf der Flucht, und Luke trifft auf Yoda." },
  { id: 330459, title: "Rogue One: A Star Wars Story", en: "Rogue One: A Star Wars Story", date: "2016-12-14", runtime: 133, genres: [28, 12, 878], keywords: [K.space], cast: [], director: [], vote: 7.5, votes: 15000, popularity: 60, overview: "Eine Gruppe Rebellen stiehlt die Pläne des Todessterns." },

  { id: 347031, title: "Swiss Army Man", en: "Swiss Army Man", date: "2016-06-24", runtime: 97, genres: [35, 18, 14], keywords: [K.dream], cast: [10980], director: [], vote: 6.9, votes: 3400, popularity: 28, overview: "", overviewEn: "A hopeless man stranded on a deserted island befriends a dead body and together they go on a surreal journey to get home." },
  { id: 83899, title: "Die Frau in Schwarz", en: "The Woman in Black", date: "2012-02-03", runtime: 95, genres: [27, 18, 53], keywords: [K.supernatural], cast: [10980], director: [], vote: 6.5, votes: 4800, popularity: 32, overview: "Ein junger Anwalt reist in ein abgelegenes Dorf und stösst auf einen rachsüchtigen Geist." },
  { id: 291805, title: "Die Unfassbaren 2", en: "Now You See Me 2", date: "2016-06-02", runtime: 129, genres: [53, 35, 28], keywords: [K.heist], cast: [10980], director: [], vote: 7.0, votes: 9800, popularity: 44, overview: "Die Illusionisten werden in einen neuen, gefährlichen Coup verwickelt." },
  { id: 6479, title: "Der junge Zauberer von nebenan", en: "The Young Wizard Next Door", date: "2019-03-15", runtime: 104, genres: [14, 35], keywords: [K.magic, K.school], cast: [], director: [], vote: 7.6, votes: 640, popularity: 6, overview: "Ein stiller Film über einen Zauberschüler, den kaum jemand kennt, der aber begeistert." },
  { id: 6480, title: "Das letzte Grimoire", en: "The Last Grimoire", date: "2017-09-22", runtime: 112, genres: [14, 12], keywords: [K.wizard, K.quest], cast: [], director: [], vote: 7.4, votes: 410, popularity: 5, overview: "Eine Bibliothekarin entdeckt ein Buch, das Geschichten verändert." },
];

/** Filme relativ zu heute, damit «Neu erschienen» und «Demnächst» dauerhaft Inhalt haben. */
export function relativeMovies(today: Date): MockMovie[] {
  const offset = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return [
    { id: 900001, title: "Nachtzug nach Zürich", en: "Night Train to Zurich", date: offset(-20), runtime: 118, genres: [53, 18], keywords: [K.crime], cast: [], director: [], vote: 7.2, votes: 320, popularity: 210, overview: "Ein Thriller, der vor wenigen Wochen angelaufen ist." },
    { id: 900002, title: "Die Glasmenagerie", en: "The Glass Menagerie", date: offset(-35), runtime: 104, genres: [18], keywords: [K.family], cast: [], director: [], vote: 6.9, votes: 150, popularity: 110, overview: "Ein kürzlich erschienenes Familiendrama." },
    { id: 900003, title: "Sternenfeuer", en: "Starfire", date: offset(-10), runtime: 131, genres: [878, 12], keywords: [K.space], cast: [], director: [], vote: 7.4, votes: 220, popularity: 180, overview: "Eine kürzlich erschienene Weltraum-Saga." },
    { id: 900004, title: "Das Echo der Berge", en: "Echo of the Mountains", date: offset(-5), runtime: 96, genres: [18, 10751], keywords: [K.family], cast: [], director: [], vote: 7.0, votes: 90, popularity: 70, overview: "Ein neues Drama aus den Alpen." },
    { id: 900011, title: "Der Uhrmacher von Genf", en: "The Watchmaker of Geneva", date: offset(21), runtime: 124, genres: [36, 18], keywords: [K.family], cast: [], director: [], vote: 0, votes: 0, popularity: 90, overview: "Ein kommender Historienfilm." },
    { id: 900012, title: "Morgenrot", en: "Red Dawn Rising", date: offset(45), runtime: 141, genres: [28, 878], keywords: [K.hero], cast: [], director: [], vote: 0, votes: 0, popularity: 260, overview: "Ein kommender Science-Fiction-Film." },
    { id: 900013, title: "Der stille Zauber", en: "The Quiet Spell", date: offset(90), runtime: 110, genres: [14, 12], keywords: [K.magic], cast: [], director: [], vote: 0, votes: 0, popularity: 150, overview: "Ein kommender Fantasyfilm." },
    { id: 900014, title: "Winterreise", en: "Winter Journey", date: offset(120), runtime: 102, genres: [18], keywords: [K.family], cast: [], director: [], vote: 0, votes: 0, popularity: 60, overview: "Ein kommendes Drama." },
  ];
}

export const SERIES: MockSeries[] = [
  {
    id: 1396, title: "Breaking Bad", en: "Breaking Bad", date: "2008-01-20", runtime: 47, genres: [18, 80], keywords: [K.drug, K.crime], cast: [17419, 84497], creator: [66633], vote: 8.9, votes: 13000, popularity: 200, status: "Ended",
    overview: "Ein Chemielehrer erfährt von seiner Krebsdiagnose und beginnt, Methamphetamin herzustellen, um seine Familie abzusichern.",
    seasons: [
      { number: 1, episodes: 7, startOffsetDays: -6500 },
      { number: 2, episodes: 13, startOffsetDays: -6100 },
      { number: 3, episodes: 13, startOffsetDays: -5700 },
      { number: 4, episodes: 13, startOffsetDays: -5350 },
      { number: 5, episodes: 16, startOffsetDays: -5000 },
    ],
  },
  {
    id: 1399, title: "Game of Thrones", en: "Game of Thrones", date: "2011-04-17", runtime: 58, genres: [10765, 18, 10759], keywords: [K.dragon, K.darkFantasy, K.quest], cast: [239019, 48], creator: [9813], vote: 8.5, votes: 25000, popularity: 300, status: "Ended",
    overview: "Mehrere Adelshäuser kämpfen in den Sieben Königslanden um den Eisernen Thron.",
    seasons: [
      { number: 1, episodes: 10, startOffsetDays: -5600 },
      { number: 2, episodes: 10, startOffsetDays: -5200 },
    ],
  },
  {
    id: 95396, title: "Severance", en: "Severance", date: "2022-02-18", runtime: 50, genres: [18, 9648, 10765], keywords: [K.office, K.dystopia], cast: [1223786], creator: [1179419], vote: 8.4, votes: 2600, popularity: 240, status: "Returning Series",
    overview: "Mitarbeitende eines Konzerns trennen ihre Erinnerungen an Arbeit und Privatleben per Eingriff.",
    seasons: [
      { number: 1, episodes: 9, startOffsetDays: -1720 },
      // Die letzten zwei Folgen liegen in der Zukunft: Sie dürfen nie als offen gelten.
      { number: 2, episodes: 6, startOffsetDays: -21, stepDays: 7 },
    ],
  },
  {
    id: 66732, title: "Stranger Things", en: "Stranger Things", date: "2016-07-15", runtime: 51, genres: [18, 10765, 9648], keywords: [K.supernatural, K.monster], cast: [], creator: [1151], vote: 8.6, votes: 17000, popularity: 280, status: "Ended",
    overview: "In einer Kleinstadt verschwindet ein Junge, und seltsame Kräfte treten zutage.",
    seasons: [{ number: 1, episodes: 8, startOffsetDays: -3700 }],
  },
];
