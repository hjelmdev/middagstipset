# Verifiering

## Automatisk kontroll

- Gemensam slutkontroll: `pnpm test` 103/103; `pnpm build` utan varningar. Initial bundle är 577,58 kB.
- Luna implementerade domän- och persistencefunktioner och skrev riktade kärntester.
- CookBatch-domän/store fick också en separat riktad körning på 29/29 tester och `tsc --noEmit`.

## Nya storkok- och lagerflöden

- Lunchlådesidan kan skapa en fryst receptsats med kostkrav och 1–120 portioner, reservera luncher från planerad sats och kräva tillagad sats innan lunch markeras som uppäten. Källans kapacitet räknar även reserverade/uppätna luncher.
- Planerade satser och luncher i perioden ingår i inköpsunderlaget utan dubbelräkning. Tillagning förbrukar kompatibelt känt skafferi en gång; ångra tillagning återför den frysta ledgern. Avräkning från skafferiet i inköpslistan kan stängas av.
- Enhetsomräkning täcker kg↔g, l/dl/cl↔ml och ml↔msk/tsk. g↔ml och omräkning till/från stycken görs inte eftersom densitet eller styckstorlek inte är känd.
- Inget riktigt Supabase-konto/projekt, Google OAuth eller RLS-flöde har testats.

## Manuell localhost-kontroll

Root kontrollerade följande flöden i localhost:

- Receptimport av text med `500 g` och `½ dl` tolkade vätskan som `50 ml`; receptet sparades och fanns kvar efter omladdning.
- En privat variant skapades från ett startrecept. Originalreceptet fanns kvar separat.
- En lunchreservation på 1,5 av 2 extra portioner markerades som uppäten, fanns kvar efter omladdning och kunde ångras och tas bort.
- En backupfil förhandsgranskades innan uttrycklig bekräftelse. Återställningen ersatte state med fixture-data: 2 personer, 7 middagar och 3 egna recept blev 1 person, 0 middagar och 0 egna recept. Ångra återställde state som fanns före importen.
- Ett storkok planerades med 5 glutenfria portioner till nästa dag. Inköpslistan visade 550 g krossade tomater och 375 g glutenfri pasta utöver den vanliga veckoplanen. När satsen markerades tillagad idag blev dagens datum tillgängligt som lunchkälla; 250 g lager förbrukades och en lunch på 1,5 portioner kunde reserveras och markeras uppäten.
- Ångra tillagningen blockerades medan en lunch var markerad uppäten. Efter att lunchmarkeringen ångrats och reservationen tagits bort kunde storkokets tillagning ångras, och de 250 g återfördes till lagret.
- I separat lagerkontroll ändrades en inköpsrad på 300 g till nettobehovet 50 g när 250 g fanns hemma. Tillagning av 150 g sänkte lagret till 100 g; ångra återställde 250 g. En avbockad rad förblev avbockad när inköpslistan räknades om efter omladdning och tillagning.
- Vid 320 px kontrollerades lunchsidan, det öppna storkoksformuläret, lagermängderna på `/hemma` och den kompakta Planera-rubriken utan horisontellt överflöde. En planerad lunch på 1,5 portioner för 10 oktober fanns kvar efter omladdning, visade källan som Storkok och angav att satsen måste vara tillagad före markering som uppäten. [Visuellt granskad skärmbild](../artifacts/storkok-and-lunch-final.jpg).
- UX-flöden för att tömma planen fungerade både för en enskild middag och för två valda middagar, och kunde ångras. Knappens antal följde urvalet 1 → 3 → 1. Filterkontrollerna kunde nås och användas.
- Hela säkerhetskopians exportnedladdning är fortsatt inte verifierad; förhandsgranskning, återställning och ångring är verifierade.

## Kvarvarande manuell kontroll

Kvarvarande QA-begränsningar är backupfilens nedladdningshändelse via verktyget samt verifiering mot ett riktigt Supabase-projekt av Auth, Google OAuth och RLS.

## Kort översikt på Idag och linjerade filter

- Idag visar som standard högst sju kommande dagar, begränsat av den valda planeringsperioden. Länken visar hela periodens dagantal. Generering och Planera behåller hela perioden.
- Filterkontrollerna har verifierats vid 320, 520 och 1280 px: inget horisontellt överflöde, 44 px kontrollhöjd och gemensam baslinje per rad. De minsta skärmarna visar selectfälten över full bredd.
- Produktionsbygget passerade utan varningar efter ändringarna.

