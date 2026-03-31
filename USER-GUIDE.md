# Smart Sort — Korisnički vodič

> **Smart Sort** je Shopify aplikacija koja automatski sortira proizvode u Vašim kolekcijama koristeći pametni algoritam koji uzima u obzir vremensku prognozu, sezonske scoreve kategorija, kvote po spolu i pravila diversifikacije.

## Sadržaj

1. [Kolekcije](#1-kolekcije)
2. [Kategorije](#2-kategorije)
3. [Opće postavke](#3-opće-postavke)
4. [Postavke kolekcije](#4-postavke-kolekcije)
5. [Raspored](#5-raspored)
6. [Prognoza](#6-prognoza)
7. [Logovi](#7-logovi)
8. [Tipičan workflow](#tipičan-workflow)

---

## 1. Kolekcije

U ovom tabu upravljate kolekcijama koje aplikacija prati i automatski sortira.

![Tab Kolekcije — lista praćenih kolekcija](docs/kolekcije.png)

### Dodavanje kolekcija

| Akcija | Opis |
|--------|------|
| **+ Dodaj** | Pretražite i odaberite jednu kolekciju iz padajućeg menija |
| **+ Dodaj sve** | Dodaje sve Shopify kolekcije odjednom (traži potvrdu prije izvršavanja) |

![Modal za dodavanje kolekcije — polje za pretragu](docs/dodaj-kolekciju.png)

### Akcije za svaku kolekciju

- **Sortiraj** — pokreće sortiranje odmah i primjenjuje novi redoslijed na Shopifyju
- **Preview** — prikazuje kako bi sortiranje izgledalo, **bez primjene** na stvarnu kolekciju
- **Postavke** — otvara vlastite postavke za tu kolekciju
- **Ukloni** — uklanja kolekciju iz praćenja (kolekcija ostaje na Shopifyju, samo se više ne sortira automatski)

![Kolekcija u listi — dugmad Sortiraj, Preview, Postavke, Ukloni](docs/kolekcija-akcije.png)

### Statusni bedževi

- **"Vlastite postavke"** — kolekcija ima vlastiti config koji se razlikuje od općih postavki
- **"Sortirano"** — kolekcija je barem jednom bila sortirana
- **"Čeka"** — kolekcija još nije bila sortirana

### Preview sortiranja

![Preview modal — tabela predloženog redoslijeda s pozicijama, kategorijama i scoreovima](docs/preview.png)

U Preview modalu vidite:
- Aktuelni temperaturni rang koji se koristi (Cold / Mild / Warm / Hot)
- Ukupan broj proizvoda
- Predloženi redoslijed s pozicijom, nazivom, kategorijom, tipom i scoreom
- Straničenje (24 proizvoda po stranici)

---

## 2. Kategorije

Ovdje definirate **sezonski score** za svaku kategoriju proizvoda i označavate **sprinklere**.

![Tab Kategorije — tabela kategorija sa scoreovima po rangu i sprinkler checkboxovima](docs/kategorije.png)

### Sezonski scorevi (1–10)

Svaka kategorija dobiva score za svaki temperaturni rang. Kategorija s višim scoreom za aktuelni rang dolazi na bolje pozicije u kolekciji.

| Rang | Simbol | Temperaturni raspon (default) |
|------|--------|-------------------------------|
| Cold | ❄️ | do 10°C |
| Mild | 🌤 | 11°C – 20°C |
| Warm | ☀️ | 21°C – 28°C |
| Hot | 🔥 | 29°C i više |

**Primjer:** Jakne s Cold=10 i Hot=1 bit će na vrhu kolekcije zimi, a na dnu ljeti.

> **Napomena:** Pri dodjeljivanju scoreva uzmite u obzir i relevantnost kategorije, ne samo sezonsku prikladnost. Score treba odražavati koliko je kategorija zanimljiva i tražena u datom trenutku — nije dovoljno da je sezonski prikladna ako je kupci rijetko aktivno traže.

### Sprinkler kategorije

Kategorije označene kao **Sprinkler** (npr. Torbe, Ruksaci, Čarape) tretiraju se kao akcesori — ubacuju se između glavnih proizvoda po posebnom redoslijedu i ne natječu se za redovne kvotne pozicije.

---

## 3. Opće postavke

Default postavke koje vrijede za **sve kolekcije**, osim onih koje imaju vlastite postavke.

![Tab Opće postavke — pregled svih sekcija](docs/07-opce-postavke.png)

### Kvote po stranici

Definirate koliko proizvoda svakog tipa se prikazuje po jednoj stranici kolekcije. **Ukupan zbroj mora biti tačno 24.**

![Sekcija Kvote po stranici — polja za unos po tipu i indikator ukupnog zbroja](docs/kvote.png)

| Polje | Opis |
|-------|------|
| Žene | Broj ženskih proizvoda po stranici |
| Muškarci | Broj muških proizvoda po stranici |
| Djevojčice | Broj proizvoda za djevojčice |
| Dječaci | Broj proizvoda za dječake |
| Bebe | Broj proizvoda za bebe |
| Žen. aksesoar | Broj ženskih aksesora (sprinkler) |
| Muš. aksesoar | Broj muških aksesora (sprinkler) |
| Ko ide prvi | **Auto** (naizmjenično), **Žene** ili **Muškarci** |

### Penali diversifikacije

Sprječavaju da ista kategorija, boja ili tip budu na uzastopnim pozicijama. Što je veća vrijednost, manja je šansa da se isti atribut pojavi u blizini.

![Tabela Penali diversifikacije — kolone prev1, prev2, prev3 za kategoriju, boju i tip](docs/penali.png)

- **> 12 = NIKAD** — ta kombinacija se nikad ne pojavljuje na toj poziciji
- **Relax mehanizam** — ako nema alternative, penali se automatski smanjuju dok se ne pronađe rješenje

### Zabranjene kategorije

Kategorije koje se **ne pojavljuju na prvoj stranici** (prvih N pozicija, defaultno 24 = cijela prva stranica). Korisno za kategorije poput Setovi ili Potkošulje koje ne trebaju biti istaknute.

![Sekcija Zabranjene kategorije — tag input sa dodanim kategorijama](docs/zabranjene.png)

Unosite naziv kategorije i pritisnete **Enter** ili **zarez**. Kliknite **×** pored naziva da uklonite kategoriju.

### Prioritet aksesoara

Redoslijed kojim se sprinkler kategorije ubacuju između glavnih proizvoda. Kategorije na vrhu liste imaju prednost.

![Drag & drop lista prioriteta aksesoara](docs/akcesori.png)

### Fallback redoslijed

Kada nema dovoljno proizvoda određenog tipa, algoritam uzima sljedeći tip iz definiranog lanca.

![Sekcija Fallback redoslijed — redovi po tipu s definiranim lancima zamjene](docs/fallback.png)

**Primjer:** Žene → Unisex → Muškarci → Ostalo
Ako nema dovoljno ženskih proizvoda za popuniti kvotu, uzimaju se Unisex, pa Muški, pa Ostalo.

### Fino podešavanje algoritma

![Sekcija Fino podešavanje — tabela težina scorea i kartice za Jitter i Relax korak](docs/algoritam.png)

| Parametar | Opis |
|-----------|------|
| **Težina — Score (kategorija)** | Koliko sezonski score kategorije utječe na finalnu poziciju (%) |
| **Težina — Varijante** | Koliko broj varijanti utječe na poziciju (%) |
| **Težina — Zalihe** | Koliko količina zaliha utječe na poziciju (%) |
| | *Suma sva tri mora biti tačno 100%* |
| **Jitter** | Nasumičnost: 0 = uvijek isti redoslijed · 0.25 = blaga varijacija · >0.5 = haotično |
| **Relax korak** | Brzina popuštanja penala: 0.90 = sporo · 0.80 = uravnoteženo · 0.60 = brzo |

---

## 4. Postavke kolekcije

Svaka kolekcija može imati **vlastite postavke** koje nadjačavaju Opće postavke samo za tu kolekciju. Sve ostale kolekcije i dalje koriste Opće postavke.

![Modal Postavke kolekcije — otvoren za jednu kolekciju, forma identična Općim postavkama](docs/postavke-kolekcije.png)

Otvorite ih klikom na **Postavke** pored naziva kolekcije. Forma je identična Općim postavkama.

### Dugmad u footeru modala

| Dugme | Opis |
|-------|------|
| **Učitaj opće postavke** | Popunjava formu trenutnim vrijednostima iz Općih postavki — forma se mijenja, ali se **ne čuva automatski**. Morate pritisnuti Sačuvaj. |
| **Obriši vlastite postavke** | Briše kolekcijski override, kolekcija se vraća na Opće postavke. Pojavljuje se samo ako kolekcija već ima vlastite postavke. |
| **Sačuvaj postavke** | Čuva promjene i primjenjuje ih za ovu kolekciju. |

![Footer modala sa dugmadima i statusni banner (plavi / zeleni / žuti)](docs/15-modal-footer.png)

---

## 5. Raspored

Automatsko sortiranje bez ručnog pokretanja.

![Tab Raspored — toggle za omogućavanje, polje za interval i sat pokretanja](docs/16-raspored.png)

| Polje | Opis |
|-------|------|
| **Omogući raspored** | Uključuje ili isključuje automatsko sortiranje |
| **Interval** | Svakih N dana pokreće sortiranje svih praćenih kolekcija |
| **Sat pokretanja** | Preporučuje se postaviti na noćni sat (npr. 03:00) kada je promet na shopu najmanji |

---

## 6. Prognoza

Aplikacija čita vremensku prognozu i prilagođava sortiranje aktuelnoj temperaturi.

![Tab Prognoza — polja za grad, sat očitavanja i temperaturne rangove](docs/17-prognoza.png)

| Polje | Opis |
|-------|------|
| **Grad** | Grad za koji se čita prognoza (npr. Sarajevo) |
| **Sat očitavanja** | Kada se svaki dan automatski čita prognoza (preporučeno 06:00) |
| **Očitaj sada** | Ručno čita trenutnu prognozu bez čekanja na zakazani sat |

### Temperaturni rangovi

Tabela u kojoj definirate granice temperature za svaki rang. Rang koji odgovara izmjerenoj temperaturi direktno određuje koji stupac scoreva iz taba **Kategorije** se koristi pri sortiranju.

![Tabela temperaturnih rangova — minimum i maksimum u °C za Cold, Mild, Warm i Hot](docs/prognoza-rangovi.png)

| Rang | Default raspon | Opis |
|------|---------------|------|
| ❄️ Cold | -20°C do 10°C | Zimski asortiman ide na vrh |
| 🌤 Mild | 11°C do 20°C | Proljetni / jesenski asortiman |
| ☀️ Warm | 21°C do 28°C | Ljetni asortiman |
| 🔥 Hot | 29°C do 45°C | Vrući ljetni dani |

Vrijednosti možete prilagoditi prema klimatskim specifičnostima Vašeg tržišta.

![Kartica zadnje očitane prognoze — temperatura, rang s bojom, datum i vrijeme](docs/18-prognoza-kartica.png)

> **Napomena:** Ako prognoza nije dostupna, aplikacija automatski koristi **kalendarski fallback**:
> - December – Februar → **Cold ❄️**
> - Mart – Maj → **Mild 🌤**
> - Juni – August → **Hot 🔥**
> - Septembar – Novembar → **Mild 🌤**

---

## 7. Logovi

Pregled historije svih sortiranja.

![Tab Logovi — tabela sa historijom sortiranja, statusima i trajanjem](docs/19-logovi.png)

Za svako sortiranje vidite:
- **Kolekcija** — koja kolekcija je sortirana
- **Trigger** — `manual` (ručno) ili `scheduled` (automatski)
- **Broj proizvoda** — koliko je proizvoda sortirano
- **Trajanje** — koliko je milisekundi trajalo sortiranje
- **Status** — `success` (uspješno) ili `error` (greška)
- **Greška** — poruka greške ako je sortiranje neuspješno

---

## Tipičan workflow

Preporučeni redoslijed postavljanja aplikacije:

![Pregled svih tabova redom — Kolekcije, Kategorije, Opće postavke, Prognoza, Raspored](docs/20-workflow.png)

1. **Dodajte kolekcije** koje želite sortirati (tab Kolekcije → + Dodaj)
2. **Podesite kategorije** — unesite sezonske scoreve i označite sprinklere (tab Kategorije)
3. **Podesite Opće postavke** — kvote, penali, fallbacki, težine algoritma (tab Opće postavke)
4. **Podesite Prognozu** — unesite grad i temperaturne granice, kliknite Očitaj sada (tab Prognoza)
5. **Podesite Raspored** — npr. svaki dan u 03:00 (tab Raspored)
6. **Pokrenite prvi sort ručno** — kliknite Sortiraj pored svake kolekcije i provjerite rezultat putem Preview-a

Za kolekcije koje trebaju drugačije postavke od ostalih:
- Otvorite **Postavke** pored naziva kolekcije
- Prilagodite samo ono što treba (ili kliknite **Učitaj opće postavke** kao polaznu tačku)
- Sačuvajte

---

*Smart Sort — automatsko, pametno sortiranje prilagođeno sezoni i temperaturi.*
