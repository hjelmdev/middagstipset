# Middagstipset

Middagstipset är en mobilanpassad Angular-app för att planera middagar, anpassa recept efter vilka som äter och hålla ihop inköpen. Appen fungerar i demoläge utan Supabase och kan använda Supabase Auth och Postgres när projektet är konfigurerat.

## Läget just nu

Grundflödet från dagens middag till recept och plan är klart. Planeringen börjar idag, har sju dagar som standard och kan ställas till 1–28 dagar. Generering fyller bara tomma dagar. Personer och portionsstorlekar, deltagare per middag, sparade sällskap, genereringsfilter, privata egna recept och varianter, granskad text-/JSON-import, JSON-export av privata recept, historik med frysta tillagningsuppgifter och inköpslista finns på plats. URL-import hämtar receptets strukturerade JSON-LD genom en autentiserad Supabase Edge Function; den funktionen behöver deployas separat till Supabase-projektet.

Etapp 3 innehåller också **Vad har jag hemma?** med canonical-ingrediens-ID:n, kända mängder och kvarvarande receptunderskott. Markering av middag eller storkok som tillagat förbrukar matchande skafferimängder; ångring återställer det exakta avdraget. Inköpslistan kan frivilligt visa nettobehovet efter skafferiet. Enhetskonvertering görs bara mellan säkra viktmått och volymmått samt matsked/tesked; gram konverteras aldrig till milliliter eller stycken. Timers och skärmlåsning stöds där webbläsaren tillåter det, men är inte verifierade på en fysisk enhet.

**Nuvarande omfattning:** etapp 1:s grund och etapp 2:s hushålls-/receptflöden är klara; Google-inloggning och privat Supabase-sparning har verifierats av projektägaren. Etapp 3 är delvis levererad genom mängdhanterat skafferi och fristående storkok. Delade hushåll, publika recept och sociala/AI-funktioner återstår. Prisfunktioner är nedprioriterade.

Hitta funktionerna här:

- **Profil → Hushåll:** lägg till och redigera personer, portionsfaktorer och kostbehov. Skapa eller ta bort sparade sällskap.
- **Planera → Personer:** välj deltagare och extra portioner för en middag. Använd ett sparat sällskap och spara ändringarna.
- **Planera → Filter:** begränsa nya förslag efter vegetariskt, favoriter och max tillagningstid. Filtren ändrar inte rätter som redan ligger i planen.
- **Planera → Lunchlådor:** reservera luncher från en middags extra portioner eller planera ett fristående storkok med ett recept och upp till 120 portioner. Välj kostkrav för tillagningen; markera satsen tillagad innan en lunch markeras som uppäten.
- **Recept → Skapa eget recept / Gör egen variant:** skapa ett privat recept eller en privat kopia av ett startrecept med eget ID.
- **Recept → Importera recept / Exportera:** hämta JSON-LD Recipe från en URL via Edge Function eller klistra in text/stödd JSON; granska och rätta utkastet innan privat sparning. Diet- och allergeninformation från källan är overifierad. Bilder hämtas inte. Exportera egna recept som JSON.
- **Idag → Vad har jag hemma?:** markera skafferivaror, ange mängd och enhet och se receptens kvarvarande underskott.
- **Profil → Historik:** se lagade middagar med recept, deltagare och portioner frysta vid tillagningstillfället.
- **Profil → Säkerhetskopiering (`/data`):** exportera eller återställ hela hushållets state.

## Kör lokalt

Kräver Node 24 och pnpm 11.25.

```sh
pnpm install
pnpm start
pnpm build
pnpm test
```

Öppna http://127.0.0.1:4200. Appen använder hash-routing och kan byggas till statiska filer. Senaste verifiering: `pnpm test` 112/112 och `pnpm build` utan varningar (initial bundle 577,75 kB). Se [docs/VERIFICATION.md](docs/VERIFICATION.md) för QA och kvarvarande kontroll.

## Demo och Supabase

Utan värden i `public/config.json` kör appen i demoläge och sparar ett lokalt testhushåll i webbläsarens localStorage. Med projektets publika Supabase-konfiguration används Google Auth och privat hushållssparning i Postgres. Projektägaren har bekräftat att inloggning och sparning fungerar. Konto och hushåll är separata begrepp i appens modell; ett hushåll kan ha flera personer som äter utan egna konton.

Supabase-klienten och den första Postgres-migrationen finns. Projektägaren har skapat och konfigurerat Supabase-projektet, Google OAuth och verifierat inloggning/sparning. URL-importens Edge Function är deployad till Middagstipsets Supabase-projekt; hela det autentiserade importflödet testas från den publicerade appen. För en ny miljö:

1. Applicera `supabase/migrations/202610080001_initial.sql` i projektet.
2. Aktivera Google som Supabase Auth-provider och konfigurera OAuth callback i Google Cloud.
3. Lägg utvecklings- och produktionsadresserna i Supabase Redirect URLs.
4. Fyll `public/config.json` med Supabase-projektets URL och publika publishable/anon-nyckel. Lägg aldrig en service-role- eller secret-nyckel i frontend.
5. Verifiera inloggning, RLS och sparning i projektet.
6. Från repots rot, länka Supabase CLI till projektet och deploya funktionen: `supabase link --project-ref <projektref>` följt av `supabase functions deploy import-recipe-url`. Kontrollera CORS-origins i `supabase/functions/import-recipe-url/index.ts` om appen får en ny publicerad adress.

Detta är en miljöchecklista. Edge Functionens lokala kod och tester innebär inte att den är deployad. Demoläge och Supabase-lager möts bakom samma repository-gränssnitt.

## Arkitektur och avgränsning

- Fristående Angular-komponenter, signals, OnPush och strict TypeScript.
- `src/app/domain/` innehåller regler och modeller som är frikopplade från Angular.
- `src/app/core/state.repository.ts` är lagringsgränsen för localStorage och Supabase.
- Hushållstillståndet är ett versionshanterat JSONB-dokument i Postgres. RLS-upplägget är avsett för ett ägarkonto per hushåll. Delade hushåll och samtidig redigering ingår inte.
- Recepten är originalexempel. Medföljande bilder är märkta efter typ och lagras som lokala assets.
- Glutenanpassning och kostmarkeringar bygger på receptdata. De garanterar inte allergisäkerhet; kontrollera alltid produktmärkning och risk för korskontaminering.
- Enhetskonvertering använder endast säkra samband: kg↔g, l/dl/cl↔ml och ml↔msk/tsk. Ingen densitet antas, så g↔ml och konvertering till/från stycken görs inte.
- Kända skafferimängder kan dras av från inköpsbehovet och förbrukas när en middag markeras som lagad. Ångra tillagning återställer det exakta avdraget. Nettobehovet på inköpslistan är valfritt och påverkar inte manuella inköpsrader.
- Ett storkok är en fryst receptsats på 1–120 portioner med valda kostkrav. Luncher kan reserveras från en planerad sats; tillagning låser dess recept- och kostsnapshot. En uppäten lunch kräver en tillagad sats, och en sats med redan uppäten lunch kan inte ångras.
- Inköpslistan tar med ingredienser för planerade satser och reservationer utan att dubbelräkna samma sats. Fryst lageravdrag återställs när en tillagning ångras.
- Lunchreservationen fryser portionsbehovet när den skapas. Senare ändring av personens portionsfaktor räknar inte om den reserverade mängden. Inköpslistan kan ta med hela den okokta middagskällan även när källdatumet ligger utanför valt middagsintervall, om en planerad lunch i intervallet använder den.
- Backup/export kopierar hela hushållets state, vilket kan innehålla privata recept, personuppgifter, planer och inköpsdata. Filen är inte auth-skyddad eller krypterad; behandla och lagra den som privat data. Restore validerar backupen före ersättning av state.

Se [docs/BACKLOG.md](docs/BACKLOG.md) för aktuell status och återstående arbete. [docs/PROJECT_VISION.md](docs/PROJECT_VISION.md) är produktunderlaget; beslutade scope i arbetsdialogen går före äldre öppna förslag där dokumenten skiljer sig.
