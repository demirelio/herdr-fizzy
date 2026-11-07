// Board names the board-group tests rely on: a "[team]" tag in three letter cases, a double space, a "+" with a
// trailing space, "acme" with and without the tag, and boards no rule picks. Order matters: the first board is the one
// shown, which the boards list never leaves out, so it is not Roadmap (tests hide that); Roadmap comes before Garden.
export const SAMPLE_BOARDS = [
  "Lighthouse", "Support rota [team]", "Roadmap", "Kites + Gliders ", "Personal", "Acme blog", "Garden",
  "Borealis  survey [team]", "Travel", "Onboarding [Team]", "Recipes", "Acme billing [team]", "Books",
  "Release train [team]", "Website for Acme", "Field notes [TEAM]",
];

export const isTeamBoard = name => name.toLowerCase().includes("[team]");
