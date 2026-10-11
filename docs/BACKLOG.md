# Middagstipset – lägesbild och backlog

Det här dokumentet beskriver vad som finns i appen i nuläget och vad som återstår. Produktvisionen i `PROJECT_VISION.md` innehåller fler idéer än den aktuella leveransen; den ska inte läsas som ett löfte om att samtliga funktioner är beslutade eller påbörjade.

## Samlad status mot produktvisionen

| Etapp | Status i appen nu |
|---|---|
| 1 – grund och middagsplanering | Klar i demoläge och med Google-inloggning/privat Supabase-sparning som projektägaren bekräftat: dagens middag, rullande plan, recept, lagring och navigation. |
| 2 – hushåll, recept och vardagsflöde | Klar: personer/kostbehov, privata recept, text-/JSON-import, historik och inköpslista. URL-importens kod finns; Edge Function behöver deployas och live-verifieras. Hushåll mellan flera konton ingår inte. |
| 3 – skafferi, matchning och storkok | Delvis klar: mängder i skafferiet, receptunderskott, frivillig lageravräkning med ångra, samt enreceptsstorkok upp till 120 portioner med lunchreservationer. Upptäckt av publika recept och den bredare sociala delen saknas. |
| Senare vision | Återstår: delade hushåll/grupper, publika och upphittningsbara recept, sociala funktioner och moderering, bild-/mediauppladdning och AI-bilder i appen, mer avancerad batch- och resthantering samt fortsatt produktionsdrift. |

Prisfunktioner är uttryckligen nedprioriterade i visionen och är inte ett nästa steg för den här leveransen. UX-justeringarna kring generering när recept saknas, tömning/ångring av plan och den kompakta Planera-toppen är verifierade.

## Levererat

### Etapp 1 – grundflöde och demo

- Angular-grund, domänregler, startrecept och receptdetaljer.
- Dagens middag, rullande planering från idag och receptval för varje datum.
- Planeringshorisont 1–28 dagar, standard sju dagar. Middagsförslag fyller bara tomma dagar; befintliga middagar lämnas ifred.
- Låsning, byte av recept, tidsgränser, favoriter, stegvis matlagning och inköpslista med avbockning och manuella rader.
- Demoläge med localStorage och en repository-gräns som kan använda Supabase när det är konfigurerat.
- Navigationen återställer scrollposition när användaren kommer tillbaka till en vy.

### Etapp 2 – hushåll, kost och privata recept

- Personer i hushållet med portionsfaktor och kostbehov. En person behöver inte ha ett konto.
- Deltagare och extra portioner kan väljas per middag. Inköpsmängderna räknas utifrån valda personer.
- Hushållspresets sparar vanliga sällskap och kan användas på en middag utan att autospara ändringen.
- Planera-filter för vegetariskt, favoriter och max tillagningstid gäller enbart nya förslag.
- Privata egna recept kan skapas och redigeras. Ett startrecept kan kopieras som privat variant med nytt recept-ID; originalet ligger kvar.
- Recepttext och stödd JSON kan klistras in, granskas och redigeras innan ett privat recept sparas. En egen Edge Function hämtar HTML från URL och extraherar strukturerad JSON-LD Recipe; utkastet granskas innan privat sparning. Bilder och diet-/allergenpåståenden hämtas inte som verifierad information. Funktionen är inte bekräftad deployad.
- Privata recept kan exporteras som JSON.
- Historik skiljer planerade datum från uttryckligen lagade middagar. Tillagning sparar en fryst kopia av recept, deltagare och portioner.
- Lunchlådor kan reservera middagars extra portioner. Portionsbehovet fryses vid reservationen; senare ändring av personens portionsfaktor ändrar inte den reserverade mängden.
- Backup/export och validerad restore använder hela hushållets state. Backupfilen kan innehålla privata recept, personuppgifter och planering och är inte auth-skyddad eller krypterad.
- Första Supabase-migrationen och Auth-/repository-klientkod finns i projektet. Projektägaren har bekräftat fungerande Google-inloggning och sparning i privat Supabase-konto.

### Etapp 3 – avgränsat skafferi

- **Vad har jag hemma?** använder receptkatalogens canonical-ingrediens-ID:n.
- Mängd och enhet kan anges för skafferivaror; matchningen visar kvarvarande underskott och sorterar förslag efter antal saknade ingredienser (0–3).
- En valfri inställning drar av kända skafferimängder från receptgenererade inköpsrader. Markering som lagad förbrukar tillgängligt lager en gång; ångra tillagning återställer den frysta avdragsjournalen.
- Enhetskonvertering begränsas till säkra samband: kg↔g, l/dl/cl↔ml och ml↔msk/tsk. Ingen densitet antas, och g↔ml eller konvertering till/från stycken görs inte.
- **Lunchlådor → Planera storkok:** skapa en fryst receptsats på 1–120 portioner med valda kostkrav, planera och reservera lunchportioner och markera satsen tillagad. Uppätna luncher kräver en tillagad källa; redan uppäten lunch hindrar att satsens tillagning ångras.
- Storkokets och middagens tillagning förbrukar matchande känt skafferi en gång; ångra tillagning återställer den frysta mängdjournalen. Planerade satser och lunchreservationer bidrar till inköpslistan utan dubbelräkning.
- Lunchlådor kan reserveras från en middags extra portioner eller från frysta storkokssatser på 1–120 portioner. Det är inte en generell produktions- eller restplanerare.
- Inköpslistan kan ta med hela den okokta middagskällan en gång, även om källdatumet ligger utanför middagsintervallet, när en planerad lunch i intervallet är beroende av den. Källdeltagarna bevaras så kända glutenfria varianter används.
- Timers och stöd för att hålla skärmen vaken finns där webbläsaren tillåter det. Detta är inte verifierat på fysisk enhet.

Senaste verifiering: `pnpm test` 112/112 och `pnpm build` utan varningar (initial bundle 577,75 kB). Se `VERIFICATION.md` för manuella flöden och kvarvarande kontroll.

## Återstående arbete

### Supabase Edge Function

- Installera/logga in med Supabase CLI, länka projektet med `supabase link --project-ref <projektref>` och kör `supabase functions deploy import-recipe-url` från repots rot. Verifiera sedan ett autentiserat anrop från GitHub Pages.
- Om appens origin ändras (till exempel när en egen domän kopplas) behöver den läggas till i funktionens CORS-lista.
- Manuell livekontroll behövs för externa receptsidor, DNS-/redirect-skydd, timeout och felmeddelanden. Lokala tester bekräftar hjälpfunktioner, inte nätverksmiljön i Supabase Edge Runtime.
- Ingen extern scraping-tjänst används; URL-fetch ansluter till den DNS-validerade IP-adressen och hanterar redirects manuellt. Faktisk deploy återstår att kontrollera.
- Funktionen begränsar tid, svarsstorlek och redirects men har ingen per-användare rate limit ännu; projektet saknar ett befintligt mönster för sådan begränsning.

### Funktioner som inte är byggda

- AI-funktioner och AI-bildgenerering i appen; användaruppladdning av media.
- Publicera, hitta och dela publika recept socialt; likes, kommentarer och moderering.
- Delade hushåll, grupper och samarbete mellan konton.
- Mer avancerad produktions- och restplanering än en fryst enreceptssats på upp till 120 portioner och dess lunchreservationer.
- Generell enhetskonvertering där måtten saknar ett säkert direkt samband, exempelvis g↔ml eller mått till/från stycken.

Varje punkt kräver separat omfattning, datamodell och acceptanskriterier innan implementation.

## Var hittar jag funktionerna?

- **Profil → Hushåll:** personer, portionsstorlek, kostbehov och sparade sällskap.
- **Planera → Personer:** deltagare och extra portioner för den valda middagen.
- **Planera → Anpassa förslagen:** filter för kommande receptförslag.
- **Planera → Lunchlådor:** reservera lunch från extra portioner vid en middag eller ett storkok.
- **Recept → Skapa eget recept / Gör egen variant:** privata recept och kopior av startrecept med eget ID.
- **Recept → Importera recept / Exportera:** importera Recipe JSON-LD från en URL via Edge Function eller klistra in text/stödd JSON, granska och redigera innan privat sparning. Exportera privata recept som JSON.
- **Idag → Vad har jag hemma?:** skafferimatchning.
- **Profil → Historik:** lagade middagar med frysta uppgifter från tillagningstillfället.
- **Profil → Säkerhetskopiering (`/data`):** exportera och återställa hela hushållets state.

## Tekniska noter

- Planen visas som ett rullande intervall från idag och kan gå över veckogränser. Lagringen behåller interna veckobuckets för kompatibilitet.
- Supabase state sparas som versionshanterat hushålls-JSONB. Nuvarande RLS-/ägarmodell är avsedd för ett konto per hushåll, inte gruppsamarbete.
- Glutenbyten och kostkompatibilitet bygger på kända data för recepten. De är inte en garanti mot allergener eller korskontaminering.
- Backupen är en kopia av hushållets state och kan därför innehålla privata recept, personuppgifter och planering. Filen är inte skyddad av auth; hantera och lagra den som privat data.
- Lunchreservationer fryser sin portionsmängd när de skapas. Ändringar av personens portionsfaktor räknar inte om äldre reservationer.
- Bygg och tester: `pnpm build` respektive `pnpm test`.
