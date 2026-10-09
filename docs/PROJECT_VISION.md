# Middagstipset – produktvision, krav och implementationsunderlag

> **Status:** Sammanställning av brainstorm, överenskomna produktprinciper, prioriteringsförslag och öppna frågor.  
> **Datum:** 2026-10-08  
> **Målgrupp:** Implementerande kodagent och produktägare.  
> **Viktigt:** Skilj på **Beslutat** (uttryckligen förankrat), **Föreslaget** (assistentens rekommendation, ej slutligt beslut) och **Framtid** (avsiktligt uppskjutet). Anta inte att alla idéer måste byggas i första versionen.

## 1. Produktvision

**Middagstipset** ska göra det enkelt att bestämma vad man ska äta, planera maten, handla och faktiskt laga den. Kärnlöftet är att kunna **generera en bra middagsvecka med ett tryck**, men användaren ska också kunna hitta dagens middag, laga av det som redan finns hemma, förbereda matlådor och planera särskilda måltider tillsammans med andra.

**Beslutade designprinciper**

- **Mobile-first och responsivt:** mobilen är primär för daglig användning, receptläsning och handling; dator ska också fungera väl.
- **Låg friktion:** dagens middag, veckoplan, recept och inköpslista ska vara lätta att hitta. Vanliga uppgifter ska kräva få tryck.
- **Smarta standardval, valfri fördjupning:** avancerade inställningar finns men får inte krävas för att komma igång.
- **Gemensam motor, flera användningsområden:** vardagsmiddagar, lunchlådor/storkok, mat av det man har hemma och särskilda tillfällen delar recept-, deltagar- och inköpslogik.
- **Komplexitet i systemet, enkelhet i gränssnittet.**
- **Prisfunktioner är nedprioriterade:** bra receptförslag och planering går före avancerad kostnadsberäkning.

## 2. Användningsfall och huvudsakliga flöden

1. **Generera veckan:** välj hushåll/deltagare och eventuellt tidsramar, skapa förslag för sju eller valfritt antal dagar, lås önskade dagar, byt en maträtt eller generera om återstående dagar.
2. **Vad lagar vi idag?:** öppna appen och se dagens rätt, tid och antal portioner; öppna receptet och laga med stegvis guidning.
3. **Handla:** få en sammanställd inköpslista för planerade måltider, med korrekt mängd för antal deltagare och kostanpassningar; bocka av och lägg till egna varor.
4. **Laga av det du har:** mata in ingredienser hemma och få **flera** receptförslag; välj bara befintliga ingredienser eller tillåt några kompletteringar; se exakt vad som saknas och lägg det på inköpslistan.
5. **Storkok/matlådor:** planera exempelvis fem luncher på söndagen, en eller flera rätter, antal portioner, förvaring och vilka dagar de ska ätas.
6. **Upptäck recept:** bläddra bland gemensamma, populära, trendande och dagsspecifikt populära recept; gilla, spara och använda dem i egna planer.
7. **Särskilt tillfälle:** planera exempelvis midsommarmiddag med vänner, gäster, recept och gemensamma inköp utan att blanda ihop privata hushållsplaner.

## 3. Informationsarkitektur och mobil UX

**Föreslagen** bottennavigation med fyra ingångar:

- **Idag:** dagens måltid, tid, antal deltagare, primärknapp *Börja laga*, snabbåtgärder som *Generera veckan*, *Laga av det du har*, *Storkok* och *Planera tillfälle*.
- **Planera:** veckoöversikt, generering, dagsspecifika inställningar, luncher/storkok och särskilda tillfällen.
- **Recept:** sök, egna/sparade/favoriter, upptäck/populärt/trendar, skapa/importera recept.
- **Handla:** sammanställd inköpslista.

Detta är en **UX-riktning, inte ett låst navigationsbeslut**. Mobilvyn ska ge tydlig dag/vecka-överblick, tider direkt på korten och enkel väg från dag till recept. Viktiga knappar ska vara tryckvänliga. Undvik att belamra skärmen med avancerade filter.

### Veckoöversikt

- Visa veckans dagar, planerade rätter och **total tillagningstid** direkt i översikten.
- Framhäv **dagens middag**.
- Öppna en dag för att se recept, portioner, anpassningar och instruktioner.
- Tillåt att låsa en rätt, byta en rätt, generera om olåsta dagar och justera deltagare.
- Stöd även luncher och andra måltider i datamodellen, trots att middagar är huvudfokus.

## 4. Recept och receptbibliotek

**Beslutat:** kombinera **färdiga recept från start** med **användarskapade/importerade recept**. En tom receptbank ger en dålig startupplevelse.

Recept ska kunna:

- Skapas, redigeras och importeras (t.ex. från text/länk; exakt importteknik beslutas senare).
- Ha namn, beskrivning, ingredienser med mängd/enhet, portioner, steg, total tid, aktiv tid, eventuell ugns-/väntetid, bild, taggar, kategori och relevanta kostegenskaper.
- Sparas till användarens/hushållets samling, markeras som favorit och användas i planer.
- Ha olika synlighet: **privat, hushåll, delat via länk, offentligt** (föreslagen modell; exakt behörighets- och publiceringsflöde återstår).
- Kopieras/anpassas som privat variant utan att ändra det publika originalet.
- Ha egna anteckningar för ett hushåll/en användare, t.ex. ”mindre chili nästa gång”.

**Viktig distinktion:** *Gilla* (social reaktion), *Spara* (behålla i samling) och *Favorit* (stark personlig preferens för planering) är olika handlingar, även om gränssnittet bör vara enkelt.

### Bilder

**Beslutad riktning:** bra bilder är viktiga. Använd en konsekvent, **fotorealistisk, hemlagad, skandinavisk** bildstil, snarare än överstylade restaurangbilder.

- Recept kan ha egna uppladdade bilder; externa bilder får endast användas när rättigheter medger det.
- AI-bildgenerering ska utgå från **receptnamn + ingredienser + beskrivning** så att bilden liknar den faktiska rätten och inte lägger till ovidkommande tillbehör.
- Genererade bilder märks tydligt som AI-genererade.
- Generera **en gång och lagra/återanvänd**; skapa inte ny bild vid varje sidvisning. Optimera storlekar för kort och detaljvy.
- **Föreslaget:** användaren kan själv välja *Generera bild* när ett eget recept saknar bild; begränsa användning/kostnad vid behov.
- **Öppet:** bildmodell, bildgenereringens MVP-omfattning, lagring och kostnadsgränser.

## 5. Taggar och strukturerade egenskaper

**Beslutat:** taggar är ett **komplement**, inte hela styrningen för generering.

- Gemensamma taggar beskriver recept generellt, t.ex. *Husmanskost, Pasta, Fisk*.
- Egna taggar kan gälla hushåll eller användare, t.ex. *Barnens favoriter, Fredagsmat, Matlåda*.
- Användaren ska enkelt kunna lägga till/ta bort taggar; systemet kan föreslå taggar från receptinnehåll.
- Håll det visuella gränssnittet enkelt även om datamodellen skiljer på globalt/hushåll/personligt.
- **Föreslagen MVP-förenkling:** globala taggar + hushållstaggar i UI; stöd för personliga taggar kan finnas i modellen och aktiveras senare.
- Skilj *vad rätten är* (t.ex. hamburgare) från **anskaffnings-/måltidstyp** (hemlagat, hämtmat, restaurang, färdigmat). Hamburgare kan vara både hemlagad och hämtmat.
- Allergier, ingredienser, tid, huvudråvara och portioner ska vara **strukturerad data**, inte enbart fria taggar.

## 6. Generering och rekommendationer

### Grundflöde

- Generera veckoplan eller valfritt antal dagar.
- Lås dagar, byt enstaka rätt och generera om olåsta dagar.
- Låt användaren välja om favoriter ska vara enda källan, prioriteras eller blandas med hela receptbanken.
- Spara historik och undvik att upprepa samma recept för ofta.
- Föreslå varierade huvudråvaror och typer av rätter under veckan.
- Ge rimliga förslag utan att användaren först måste konfigurera ett regelverk.
- Visa gärna en enkel motivering: ”Familjefavorit, inte lagad på länge, passar dagens tidsram”.

### Prioritering av signaler

1. **Hårda krav:** allergier, säker kostanpassning, uttryckliga exkluderingar och deltagarnas behov.
2. **Receptdata och dagliga förutsättningar:** ingredienser, huvudråvara, tillagningstid, portioner och måltidstyp.
3. **Variation och historik:** nyligen tillagat, fördelning över veckan, undvik monoton plan.
4. **Preferenser:** favoriter, tidigare val, hushållets smak och valfria prioriteringar.
5. **Mjuka signaler:** taggar, popularitet, trender och veckodagstrender.
6. **Pris/budget:** kan läggas till senare, ska inte blockera MVP.

**Föreslagen implementation:** börja med transparent regelbaserad/viktad rekommendation. AI är inte ett krav för själva urvalet. AI kan hjälpa vid import, bildgenerering, receptförslag och senare bildtolkning.

### Tid och aktiviteter

- Visa **total tid** och **aktiv tid** separat i receptet; total tid syns i veckovyn.
- Stöd **maximal tillagningstid per veckodag** och snabbmiddag på hektiska dagar.
- Föreslaget: återkommande aktiviteter, t.ex. träning på tisdagar, kan automatiskt ge kortare tidsramar. Manuell tidsram per dag räcker som första steg.

## 7. Användare, hushåll och deltagare

**Beslutat:** inloggade konton är **inte** samma sak som antalet personer som äter.

Begrepp:

- **User:** person med inloggning.
- **Household:** varaktigt hushåll med preferenser, receptsamling och planering.
- **HouseholdMember/Person:** faktisk person i hushållet; kan vara barn utan inloggning och senare länkas till konto.
- **MealParticipant:** person som äter en specifik måltid, plus eventuella gäster.
- **Group/Event:** separat samarbete för vänner, släkt eller ett särskilt tillfälle.

Exempel: en vuxen och två barn; vissa veckor äter den vuxne ensam, ibland med ett barn, ibland alla tre.

- Gör det enkelt att välja **”bara jag”, ”jag + ett barn”, ”alla tre”** som återanvändbara deltagarpresets.
- Låt varje dag avvika från veckans standard.
- Portionsmängd ska bero på vilka som äter, inte antalet användarkonton.
- Gäster ska kunna läggas till utan krav på konto.
- **Föreslaget:** portionsstorlek per person (t.ex. barn/vuxen) för bättre mängdberäkning; håll UI lättbegripligt.

## 8. Kostbehov och anpassningar – kritiskt krav

**Beslutat:** kostanpassning måste kunna ske **per recept och per komponent**, inte bara genom att filtrera fram recept märkta ”glutenfritt”.

Exempel för hushållet med en glutenfri person:

- **Pasta med sås:** vanlig pasta till två personer, glutenfri pasta till en person, **gemensam glutenfri och säker sås**.
- **Lasagne:** en **helt glutenfri lasagne till alla**, inte två separata gratänger.

Krav:

- Spara hushållets föredragna anpassning för ett visst recept.
- Beräkna inköpsmängder för separata komponentvarianter korrekt.
- Kunna stödja flera parallella behov (t.ex. glutenfri, laktosfri, vegetarisk) på sikt.
- **Säkerhet:** varna för gluteninnehåll och korskontaminering; använd inte AI:s antagande som garanti för allergisäkerhet. Kontrollera ingredienser och märkning.
- Receptet ska visa anpassningar tydligt både i ingredienslistan och matlagningsstegen.

## 9. Receptvy och matlagningsläge

**Beslutad UX-riktning:** mobilvänlig receptdetalj med:

- Tydlig bild, namn, total/aktiv tid, deltagare och portioner.
- Välj vilka som äter; lägg till extra portioner eller matlådor; räkna om ingredienser.
- Visa separata kostvarianter, t.ex. vanlig och glutenfri pasta.
- Ingredienser grupperade i begripliga kategorier; kunna bocka av.
- Två lägen: **kompakt vy** (hela receptet synligt) och **steg-för-steg-läge** (ett moment åt gången).
- Stora steg, nästa/föregående, valfria inbyggda timers, håll skärmen vaken där enheten tillåter.
- Markera ”lagat” och uppdatera historiken.
- **Föreslaget:** ”Förbered i förväg” för matlådor och storkok.

Den tidigare interaktiva receptskissen var en **UX-prototyp**, inte en slutligt verifierad recept-/närings- eller livsmedelssäkerhetsdefinition.

## 10. Inköpslista

- Genereras från valda recept och planerade portioner.
- Summerar samma normaliserade ingrediens från flera recept och tar hänsyn till kostvarianter.
- Grupperar efter butikskategori/avdelning.
- Tillåter manuellt tillagda varor som **inte försvinner** när recept eller veckoplan ändras.
- Bocka av under handling; ändringar i plan ska uppdatera receptgenererade rader på begripligt sätt.
- Saknade ingredienser från ”Laga av det du har” kan läggas till med ett tryck.
- **Framtid:** avräkning mot digitalt skafferi, förpackningsoptimering och butiksintegration.

## 11. ”Vad kan jag laga av det jag har hemma?”

**Beslutat: viktigt användningsfall.**

### MVP-flöde

1. Användaren anger manuellt ingredienser som finns hemma.
2. Välj **”Bara det jag har”** eller **”Jag kan komplettera med 1–3 ingredienser”**; eventuellt ett friare läge.
3. Visa **flera** receptförslag, inte bara en träff.
4. Varje förslag visar tillagningstid, vilka ingredienser som finns och **exakt vilka som saknas**.
5. Sortera/filtrera exempelvis *kan laga direkt*, *minst komplettering*, *snabbast*, *bästa matchning*.
6. Lägg saknade ingredienser på inköpslistan.
7. Respektera deltagare, portioner, kostbehov och hushållets preferenser.

**Prisjustering:** uppskattad kompletteringskostnad var en omtyckt idé, men användaren har senare uttryckligen **nedprioriterat pris**. Visa saknade ingredienser utan pris i MVP; kostnad kan tillkomma senare.

### Framtid

- Fotografera kylskåp/skafferi; AI föreslår identifierade ingredienser, användaren bekräftar/rättar.
- Eventuellt digitalt skafferi och ”använd först” för varor som snart blir dåliga.
- Kräv **inte** att användaren ständigt uppdaterar ett fullständigt lagersaldo.

## 12. Storkok, lunchlådor och rester

**Beslutat användningsområde:** planera t.ex. söndagens storkok för fem luncher under arbetsveckan.

- Välj antal luncher/portioner och antal olika recept (en, två eller flera).
- Välj egna recept eller generera förslag; prioritera frysvänliga rätter vid behov.
- Planera **tillagningsdag** och **konsumtionsdagar** separat.
- Lägg inköpsbehov på samma inköpslista som veckans middagar.
- Visa lämplig kyl-/frysförvaring och hantera säker nedkylning.
- Stöd flödet **”laga extra till middag och använd rester som lunch”** utan dubbelräkning av ingredienser.
- **Arkitekturell riktning:** skilj planerade, tillagade, uppätna och kvarvarande portioner; exakt lagerspårning kan fasas in stegvis.

## 13. Grupper, delning och särskilda tillfällen

**Beslutad produktinriktning:** vanliga hushåll och fristående grupper/evenemang är **olika begrepp**.

- Hushållet har sina vardagsplaner, kostpreferenser och privata recept.
- En vän-/familjegrupp kan samarbeta om en plan eller dela recept.
- Ett evenemang (midsommar, födelsedag, resa) har datum, gäster, valda rätter och gemensam inköpslista.
- **Föreslagna framtida funktioner:** ansvarsfördelning (vem lagar/tar med vad), omröstning, budget och samordning av flera hushåll.
- Delning får inte exponera ett hushålls privata information av misstag.

## 14. Sociala funktioner, popularitet och trender

**Beslutat:** offentliga recept ska kunna upptäckas genom **populärt**, **trendande** och **veckodagsspecifika favoriter**. Stöd likes och sparningar.

### Separata användarsignaler

- **Visning:** receptet har öppnats; undvik att räkna upprepade automatiska laddningar som verkligt intresse.
- **Gilla:** uttrycklig social reaktion.
- **Spara:** receptet läggs i en personlig samling.
- **Favorit:** stark preferens i egen/hushållets planering.
- **Planerad:** receptet har lagts på en viss dag.
- **Tillagad:** användaren markerar att måltiden faktiskt lagats.

### Upptäcktsytor

- **Populärast:** starkt och varaktigt intresse, där sparningar och faktiska tillagningar väger mer än enbart visningar.
- **Trendar nu:** ökat intresse under kortare tidsperiod.
- **Mest lagade:** baserat på faktiska tillagningar.
- **Nya recept:** exponering även för nya recept utan etablerad popularitet.
- **För dig:** personaliserade förslag.
- **Populärt på [veckodag]:** t.ex. tacos på fredagar, utifrån aggregerade faktiska val, **inte hårdkodade associationer**.

### Veckodagstrender

- Registrera både **planerat datum** och **faktiskt tillagat datum** där det finns.
- Beräkna hur populär en rätt är på en viss veckodag relativt dess popularitet andra dagar.
- Kunna gruppera närbesläktade recept (t.ex. olika sorters tacos) för trendberäkning utan att förlora statistik på enskilda recept.
- Veckodagstrender ska vara en **mjuk signal**, aldrig ett tvingande val.
- Använd aggregerad statistik med integritetshänsyn; undvik att exponera enskilda hushålls måltidsvanor.

### Kommentarer och betyg

- **Kommentarer:** önskvärda men **föreslaget senare**, eftersom moderering, spam och rapportering krävs.
- **Stjärnbetyg:** möjligt senare; behöver inte vara del av första versionen.
- **Privata receptanteckningar:** föreslaget tidigt, ger nytta utan social moderering.

## 15. Pris och budget – uttryckligen nedprioriterat

Tidigare diskuterades genomsnittspriser per normaliserad ingrediens, portionskostnad, veckobudget, prisprofiler (*billig/normal/lyx*), kompletteringskostnad och senare butiksspecifika erbjudanden.

**Senaste beslutet väger tyngst:** pris ska **inte vara en viktig del av MVP** och kan helt skjutas upp.

- **MVP:** inga obligatoriska prisdata, inga prisberoende rekommendationskrav.
- **Eventuell lättviktig funktion:** grov prisetikett, endast om den kan implementeras utan att bromsa kärnflödet.
- **Senare:** genomsnittspriser, kostnad per använd mängd kontra kostnad för hela inköpsförpackningar, kompletteringskostnad, budgetstyrning.
- **Framtid:** butiksspecifika priser, kampanjer, uppladdade reklamblad, automatisk erbjudandeanalys.
- **Arkitekturellt:** behåll strukturerade ingredienser, normaliserade enheter och kvantiteter så att priser kan kopplas på senare.

## 16. Förslag på avgränsad MVP och etapper

> Detta är en **rekommenderad prioritering**, inte ett uttryckligt slutbeslut om releaseplan. Projektet har många identifierade MVP-kandidater; bygg dem stegvis.

### Etapp 1 – fungerande middagsvecka

- Grundläggande konto och hushåll.
- Liten startbank med recept och bilder.
- Receptdetalj med ingredienser och instruktioner.
- Generera en vecka, byt en dag, lås valda dagar.
- Startsida med dagens middag och veckoöversikt, inklusive tillagningstid.
- Mobilanpassad navigation.

### Etapp 2 – gör planeringen praktiskt användbar

- Deltagare per dag, portioner och hushållspresets.
- Glutenfri/per-komponent-anpassning och korrekt ingrediensberäkning.
- Automatisk inköpslista och manuella inköpsposter.
- Matlagningsläge, historik, favoriter och tidsramar per dag.
- Skapa/importera egna recept och privata varianter.

### Etapp 3 – upptäckt och smarta förslag

- Gemensamma recept, synlighet, sparningar, likes.
- Populära/trendande/dagsspecifika recept och enkel analys av signaler.
- ”Laga av det du har” med flera matchningar och saknade ingredienser.
- Globala och hushållsspecifika taggar.
- Storkoksplanering och lunchlådor.

### Etapp 4 – samarbete och utbyggnad

- Grupper och särskilda tillfällen.
- Mer avancerad resthantering och delad planering.
- Kommentarer/moderering, betyg, bildtolkning, digitalt skafferi och prisfunktioner.

**Viktigt:** Etappindelningen ovan innebär inte att exempelvis ingrediensmatchning, storkok eller popularitet saknar MVP-värde. Om ambitionen är att de ska finnas i första offentliga versionen kan de byggas som senare etapper **före** lansering. Bestäm releasegräns separat.

## 17. Föreslagen konceptuell datamodell

Inte ett färdigt databasschema; namn och relationer är förslag som agenten ska konkretisera efter teknikval.

| Entitet | Ansvar |
|---|---|
| `User` | Inloggning och användarprofil |
| `Household` | Varaktigt hushåll, inställningar och samling |
| `HouseholdMember` | Person med kostbehov/portionsprofil, eventuellt utan konto |
| `HouseholdMembership` | Kontobehörighet i hushåll |
| `Recipe` | Receptmetadata, upphov, synlighet, tider och standardportioner |
| `RecipeIngredient` | Normaliserad ingrediens, mängd, enhet, komponent |
| `Ingredient` | Gemensam ingredienskatalog, alias och enhetsnormalisering |
| `RecipeStep` | Ordnade tillagningssteg och eventuella timers |
| `RecipeImage` | Bildkälla, lagringsreferens, AI-markering |
| `RecipeVariation` / `HouseholdRecipeAdaptation` | Person-/hushållsspecifika substitutioner och komponentvarianter |
| `Tag`, `RecipeTag` | Globala och lokala taggar med ägare/scope |
| `SavedRecipe`, `FavoriteRecipe`, `RecipeLike` | Skilda relationer för sparning, favorit och gillning |
| `RecipeEvent` | Visning, planering, tillagning; tid och ev. veckodag för aggregering |
| `MealPlan` | Plan för hushåll, användare, grupp eller evenemang |
| `PlannedMeal` | Dag, måltidstyp, recept, status, låsning och portionsval |
| `MealParticipant` | Person/gäst som äter just denna måltid |
| `ShoppingList`, `ShoppingListItem` | Receptgenererade och manuella varor, avbockning |
| `PantryInput` | Tillfälligt angivna ingredienser för receptmatchning |
| `CookBatch` / `PreparedPortion` | Storkok, tillagade och fördelade portioner (kan förenklas initialt) |
| `Group`, `Event`, `EventParticipant` | Separat samarbete och speciella tillfällen |

### Arkitekturprinciper

- Separera **receptdefinition** från **receptinstans i plan** och från **faktiskt tillagningstillfälle**.
- Separera **användare** från **person som äter**.
- Separera **globala receptdata** från **hushållets egna anpassningar**.
- Skilj **receptgenererade inköpsrader** från **manuellt tillagda rader**.
- Bevara tydlig skillnad mellan **planerat**, **tillagat**, **sparat**, **gillat** och **visat**.
- Modellera måltidstyp (frukost/lunch/middag), tillagningsdatum och konsumtionsdatum separat.
- Förbered för säker auktorisering på privat/hushåll/grupp/offentligt innehåll.
- Bygg inte rekommendationsmotor eller kostbehovshantering på enbart fria taggar.
- Samla in så lite personlig data som krävs, särskilt kring barns profiler och kostbehov.

## 18. Tekniska val – ej beslutade

Användaren har erfarenhet av **Angular**, **.NET/C#**, Azure och agentbaserad utveckling med Codex. Tidigare har **Supabase** samt **Neon + Clerk** diskuterats för andra projekt, men **inget teknikval för Middagstipset är låst**.

Kodagenten ska därför **inte anta** att projektet redan använder Angular, Supabase, Neon, Clerk, .NET eller Azure. Föreslå ett rimligt mobile-first webbupplägg efter att ha inspekterat befintligt repo och diskuterat eventuella krav på drift, budget och inloggning.

Övriga öppna tekniska frågor:

- Receptimport från URL, strukturerad text eller manuellt formulär.
- AI-bildleverantör, bildgenereringskostnad och lagring.
- Rekommendationspoäng, förklaring och schemalagda trendaggregeringar.
- Normalisering av ingrediensnamn, mängder, enheter och substitutioner.
- Integritet, rättigheter och moderering för publikt innehåll.
- Offline-stöd, timers, wake lock och PWA-funktioner.
- Gräns mellan MVP, privat beta och första publika lansering.

## 19. Definition of Done – produktnära acceptanskriterier

1. En ny användare kan få en användbar middagsvecka utan att först skapa egna recept.
2. På mobilen syns dagens rätt och tiden det tar direkt efter att appen öppnats.
3. En dag kan bytas utan att låsta dagar försvinner.
4. Antal portioner följer **de faktiska deltagarna**, även barn utan inloggning.
5. Ett pastarecept kan beräkna både vanlig och glutenfri pasta; ett lasagnerecept kan tillagas helt glutenfritt för alla.
6. Inköpslistan summerar ingredienser korrekt och behåller manuella tillägg.
7. Användaren kan öppna receptet och följa det stegvis på mobilen.
8. Användaren kan ange vad som finns hemma, få flera relevanta förslag och se saknade ingredienser utan prisfunktion.
9. Storkok kan planeras som en tillagning med flera framtida lunchportioner utan dubbelräkning.
10. Ett offentligt recept kan sparas/gillas; planering och faktisk tillagning kan skiljas åt för framtida popularitetsanalys.
11. Popularitet per veckodag är en mjuk rekommendationssignal, inte ett hårdkodat schema.
12. Privata hushållsrecept och kostuppgifter blir inte publika genom sociala funktioner eller gruppplanering.

## 20. Instruktion till implementerande kodagent

1. **Läs detta dokument som produktunderlag, inte som ett mandat att bygga allt på en gång.**
2. **Inventera befintligt repo först** (om något finns). Fråga innan större arkitektur- eller teknikbeslut om de inte redan är fastlagda.
3. Ta fram en **konkret, prioriterad backlog** med beroenden och tydliga acceptanskriterier; särskilj beslutat från föreslaget.
4. Föreslå **minsta fungerande vertikala flöde**: användare → recept → genererad vecka → dagens middag → receptvy.
5. Modellera kostanpassning, deltagare och ingredienser tillräckligt väl för att slippa grundläggande ombyggnad senare, men överimplementera inte framtidsfunktioner.
6. Prioritera **mobile-first UX, snabbhet, enkel navigation och bra standardvärden**.
7. Implementera med tester för kritisk domänlogik: portionsskalning, kostvarianter, låsta dagar, inköpssummering och receptmatchning.
8. Använd inte externa receptbilder utan rättigheter och presentera inte AI-bilder som faktiska fotografier av användarens rätt.
9. Gör en avstämning om **releasegräns och öppna produktfrågor** innan större arbete med sociala funktioner, grupper, pris eller avancerad AI.
10. Håll framtida idéer dokumenterade och möjliga, men låt dem inte blockera första fungerande versionen.

---

## 21. Kort beslutslogg

| Område | Senaste riktning |
|---|---|
| Grundidé | Generera en middagsvecka enkelt, men stöd många användningsfall |
| Mobil | Mobile-first, enkel navigering, dagens rätt i fokus |
| Receptbank | **Både** startrecept och egna/importerade recept |
| Receptbilder | Bra, konsekventa bilder; AI-bild från faktiskt receptinnehåll |
| Taggar | Globala och egna; **komplement**, inte enda genereringslogiken |
| Kostbehov | Per person **och per komponent/recept**, inklusive glutenfri anpassning |
| Deltagare | Skilda från inloggade konton; enkla hushållspresets |
| Tid | Total och aktiv tid; tidsramar för hektiska dagar |
| Receptvy | Mobilvänlig, ingredienser, portionsval, stegvis matlagning |
| Inköp | Automatiskt sammanställd lista med manuella tillägg |
| Hemma-ingredienser | Flera förslag; visa vad som saknas; valbara kompletteringar |
| Kylskåpsfoto | Framtida AI-funktion, inte nödvändig i MVP |
| Storkok | Söndagsmatlagning, flera lunchlådor, rester |
| Grupper | Separat från hushåll; särskilda tillfällen |
| Socialt | Populärt, trendande, likes, sparningar, dagsspecifik popularitet |
| Kommentarer | Önskvärda, men föreslaget senare |
| Pris | **Nedprioriterat** och får skjutas efter MVP |
| Teknik | Inte beslutad |

**Slutsats:** Bygg först en snabb, enkel och användbar matplanerare. Utöka med intelligent rekommendation, receptcommunity och samarbete utan att förlora den enkla vardagsupplevelsen.
