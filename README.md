# Chess Analytics : ton rapport Chess.com ou Lichess analysé par Stockfish

Ce script récupère tes parties publiques sur Chess.com ou Lichess, les fait analyser par le moteur Stockfish, et génère un tableau de bord HTML avec :

- **tes résultats** : score par cadence, Blancs contre Noirs, score selon l'écart d'Elo, évolution de l'Elo ;
- **tes ouvertures** : score, et évaluation Stockfish de la position après 12 coups ;
- **ton comportement** : score après une victoire ou une défaite, au fil d'une session, selon l'heure de jeu ;
- **l'analyse Stockfish** : gaffes, erreurs, imprécisions et précision par phase de jeu, résultats par type de finale, motifs tactiques de tes erreurs (fourchettes, clouages, matériel en prise, mats), erreurs selon le temps de réflexion, erreurs en zeitnot, occasions manquées, positions gagnantes non converties, positions perdantes sauvées ;
- **tes 3 priorités d'entraînement**, classées selon les points qu'elles te coûtent, avec des exemples tirés de tes parties ;
- **les moments critiques** : chaque erreur avec le meilleur coup, et un lien qui ouvre la position sur l'échiquier d'analyse Lichess.
- **l'étude de position** : évaluer une position calme, dire d'où vient l'avantage, repérer ses éléments (structure de pions, sécurité du roi, activité des pièces, pièces en prise), trouver la menace adverse puis choisir son coup, avec un score par thème qui suit ta progression ;
- **les positions où tu te trompes** : ton taux d'erreurs selon ce qu'il y a sur l'échiquier (roi resté au centre, roi adverse exposé…), comparé à ta moyenne.

Aucun compte ni mot de passe n'est nécessaire : seul l'identifiant Chess.com ou Lichess est utilisé, et les parties sont publiques.

## Installation

Il faut **Python 3.9 ou plus récent** ([python.org](https://www.python.org/downloads/) ; sous Windows, coche « Add Python to PATH » pendant l'installation).

Dans un terminal, depuis le dossier du projet :

```
python -m pip install -r requirements.txt
```

C'est tout. **Stockfish est téléchargé automatiquement** dans le dossier `stockfish/` à la première analyse (Windows, macOS et Linux).

## Utilisation

```
python chess_dashboard_generator.py --user ton_identifiant
```

Le rapport est créé dans `rapports/ton_identifiant/` :

- `chess_dashboard.html` : le tableau de bord, à ouvrir dans un navigateur ;
- `chess_games.csv` : toutes les parties, à ouvrir dans Excel.

Pour des parties **Lichess**, ajoute `--site lichess` :

```
python chess_dashboard_generator.py --site lichess --user ton_identifiant
```

Le rapport est alors créé dans `rapports/lichess_ton_identifiant/`. Les cadences Lichess sont `ultraBullet`, `bullet`, `blitz`, `rapid`, `classical` et `correspondence`. La précision Lichess n'est disponible que pour les parties que tu as fait analyser sur le site.

Par défaut, le script prend **les 6 derniers mois** et analyse avec Stockfish **les parties rapid** uniquement. Les statistiques de résultats couvrent toutes les cadences.

### Options

| Option | Effet | Exemple |
|---|---|---|
| `--site` | site des parties : `chesscom` (défaut) ou `lichess` | `--site lichess` |
| `--user` | identifiant Chess.com ou Lichess du joueur | `--user magnuscarlsen` |
| `--since` | premier mois pris en compte (AAAA-MM) | `--since 2026-01` |
| `--cadences` | cadences analysées par Stockfish (`rapid`, `blitz`, `bullet`, `daily`, ou `all`) | `--cadences rapid,blitz` |
| `--depth` | profondeur d'analyse : plus haut = plus précis mais plus lent | `--depth 16` |
| `--workers` | nombre de moteurs en parallèle (défaut : nombre de cœurs − 2) | `--workers 4` |
| `--no-analysis` | ne lance pas Stockfish ; utilise seulement les analyses déjà faites | |
| `--refresh` | re-télécharge aussi les parties déjà en cache | |

### Combien de temps ça prend ?

La première analyse est la plus longue. Sur un PC à 14 cœurs (12 moteurs en parallèle), 350 parties rapid ont pris environ 15 minutes. Sur un portable à 4 cœurs, compte plutôt une heure. Le blitz va plus vite par partie.

Les analyses sont gardées dans `cache/`. **Les exécutions suivantes n'analysent que les nouvelles parties** et prennent quelques secondes. Si tu interromps le script (Ctrl+C), tu peux le relancer : il reprend là où il s'était arrêté.

## Comment lire l'analyse

- **Imprécision, erreur, gaffe** : coup qui fait perdre au moins 10, 20 ou 30 points de pourcentage de chances de gain selon Stockfish. Ce sont les mêmes seuils que Lichess.
- **Phases** : l'ouverture couvre les 12 premiers coups. La finale commence quand il reste peu de pièces : 26 points de matériel ou moins, pions exclus (dame = 9, tour = 5, fou et cavalier = 3). Le milieu de partie est entre les deux.
- **Zeitnot** : coup joué avec moins de 10 % du temps initial à la pendule (et au minimum 15 secondes).
- **Occasion manquée** : l'adversaire vient de faire une grosse erreur, et ton coup ne la punit pas.
- **Position gagnante** : au moins 80 % de chances de gain, soit environ +4. **Position perdante** : 20 % ou moins ; elle est « sauvée » si la partie finit par une nulle ou une victoire.
- **Motifs tactiques** : pour chaque erreur, ce que le meilleur coup gagnait (« manqué ») et ce que la meilleure réponse adverse gagne après ton coup (« subi ») : matériel (prise d'une pièce non défendue ou plus précieuse), fourchette (une pièce attaque deux cibles), clouage sur le roi, mat. La détection ne regarde qu'un coup : une combinaison plus longue apparaît « sans motif ».
- **Type de finale** : selon les pièces restantes à l'entrée en finale (rois et pions exclus). Le score « attendu » est celui que donneraient exactement tes chances de gain à ce moment-là.
- **Session** : parties enchaînées à moins d'une heure d'intervalle.
- **Marge du hasard** : un écart est signalé comme net seulement s'il dépasse deux écarts-types (pour l'objectif +200 Elo, estimés en rééchantillonnant les parties). En dessous, avec ce nombre de parties, il pourrait n'être que de la chance.
- **Temps de réflexion** : temps passé sur le coup, rapporté au temps total d'une partie (temps initial + 40 incréments). En 10 min : « réflexe » = moins de 6 s, « longue réflexion » = 48 s et plus.
- **Priorités** : chaque partie non gagnée est attribuée à une cause principale (pendule, conversion d'une position gagnante, phase de la plus grosse erreur, ou jeu positionnel s'il n'y a pas d'erreur nette). Les causes sont classées selon les points perdus : 1 par défaite, ½ par nulle.

Ce sont des indicateurs statistiques. Ils montrent où regarder ; ils ne remplacent pas l'analyse de tes parties.

## Ce que contient le tableau de bord

| Onglet | Contenu |
|---|---|
| **Accueil** | Chiffres clés, tes 3 priorités d'entraînement, et l'**objectif +200 Elo** : tes indicateurs Stockfish comparés à ceux de joueurs 200 points au-dessus de toi dans ta cadence principale. Ces joueurs sont choisis parmi tes propres adversaires, puis parmi leurs adversaires du même niveau ; l'échantillon est renouvelé tous les 30 jours. |
| **Statistiques** | Résultats, ouvertures, et **Mon répertoire** : tes ouvertures coup par coup, ton score dans chaque ligne, et les coups où Stockfish recommande mieux. |
| **Analyse** | Ta progression mois par mois, erreurs par phase, causes des défaites, moments critiques, positions gagnantes non converties. |
| **S'entraîner** | Exercices sur tes propres positions, avec répétition espacée. Les autres coups que Stockfish juge presque aussi bons sont acceptés. Après un exercice, « Jouer la suite contre Stockfish » te fait continuer la partie dans le navigateur. Mode « Étudier la position » : une position calme à évaluer (qui est mieux, et de combien), puis dire d'où vient l'avantage, cocher des énoncés sur ses éléments (pour toi et pour l'adversaire, avec explications et cases surlignées), trouver ce que menace l'adversaire et enfin jouer ton coup, jugé par Stockfish dans le navigateur. Les positions sont calmes (l'évaluation ne bouge pas dans les coups suivants) et viennent de tes parties, de celles de joueurs plus forts que toi et de parties longues (cadence classique) de joueurs du haut du classement Lichess, choisies d'abord sur tes thèmes les plus faibles, tes ouvertures et ta phase la moins précise ; ton score par thème et son évolution mensuelle sont suivis. « Synchroniser mes appareils » transfère ta progression d'un appareil à l'autre par un lien. |
| **Adversaire** | Entre le pseudo d'un adversaire : ses parties récentes sont analysées pour trouver ses ouvertures, ses points forts et ses points faibles. |
| **Historique** | Toutes les parties, avec recherche et export CSV. |

La première exécution après une mise à jour peut être plus longue : Stockfish calcule les coups alternatifs des parties déjà analysées, et les parties de l'échantillon de l'objectif.

## Plusieurs joueurs : le fichier `amis.txt`

`amis.txt` liste les joueurs, un par ligne, avec les mêmes options qu'en ligne de commande :

```
--site chesscom --user mahmoud_ben_salem --since 2026-04 --cadences rapid
--site lichess  --user amengaieb         --since 2020-03 --cadences blitz
```

```
python chess_dashboard_generator.py --amis amis.txt
```

génère tous les rapports, puis la page d'accueil `rapports/index.html` avec un lien vers chaque joueur. `amis.txt` reste sur ton PC : il n'est pas envoyé sur GitHub. Les options données en ligne de commande (`--no-analysis`, `--refresh`, `--workers`) s'appliquent à tous les joueurs.

## Publier les rapports en ligne, chacun avec son mot de passe

Le site est publié gratuitement sur GitHub Pages et mis à jour **chaque nuit**. Chaque rapport est **chiffré** (AES-256) avec le mot de passe de son joueur : sans ce mot de passe, personne ne peut le lire, même en téléchargeant le fichier. Tes amis n'ont rien à installer : ils ouvrent leur lien, entrent leur mot de passe, et peuvent cocher « Se souvenir sur cet appareil ».

### 1. Un mot de passe par joueur

Dans `amis.txt`, chaque ligne se termine par `--mot-de-passe ...`. Pour en créer un solide :

```
python chess_dashboard_generator.py --nouveau-mot-de-passe
```

Transmets à chaque ami son lien et son mot de passe **en privé**. Un mot de passe faible pourrait être deviné.

### 2. Mise en place sur GitHub, une seule fois

1. Crée un dépôt **public** sur GitHub et envoie le projet dessus. `amis.txt`, `rapports/` et `site/` ne sont jamais envoyés (`.gitignore`). `cache/analyses.json` l'est, pour que les analyses déjà faites sur ton PC ne soient pas refaites.
2. **Settings → Secrets and variables → Actions → New repository secret** : nom `AMIS`, valeur = tout le contenu de ton `amis.txt`.
3. **Settings → Pages → Source : GitHub Actions**.
4. Onglet **Actions → Rapports → Run workflow**.

Le lien de chaque joueur est `https://<ton-compte>.github.io/<dépôt>/<joueur>/`, où `<joueur>` est par exemple `mahmoud_ben_salem` (Chess.com) ou `lichess_amengaieb` (Lichess). La page d'accueil du site ne liste aucun nom.

### Ajouter un ami ou changer un mot de passe

Modifie `amis.txt`, puis recopie-le dans le secret `AMIS` (Settings → Secrets → AMIS → Update). La première analyse d'un nouvel ami peut prendre une heure ou plus sur GitHub ; tu peux aussi la lancer sur ton PC avec `--amis amis.txt`, puis envoyer `cache/analyses.json`.

### Ce qui reste visible

Les pseudos suivis apparaissent dans les journaux d'exécution de GitHub (publics), mais jamais les résultats ni les mots de passe. Quiconque a le mot de passe d'un rapport peut le lire.

Pour vérifier en local ce qui sera publié : `python chess_dashboard_generator.py --amis amis.txt --publier` écrit le site dans `site/`.

## Partager un rapport

`chess_dashboard.html` est un fichier autonome : tu peux l'envoyer tel quel par e-mail ou messagerie. Il faut juste une connexion internet pour afficher les graphiques.

## Partager le script

Envoie le dossier **sans** les sous-dossiers `stockfish/`, `cache/`, `rapports/` et `ancienne_version/` : ils sont volumineux ou personnels, et sont recréés automatiquement. Les fichiers utiles sont :

```
chess_dashboard_generator.py
chess_analysis.py
requirements.txt
README.md
templates/
tests/
web/
```

Le fichier `.gitignore` exclut déjà ces dossiers si tu publies le projet sur GitHub.

## Tests

```
python -m unittest discover -s tests
```

Ils vérifient les calculs Stockfish, la lecture des parties, le répertoire, l'échantillon de l'objectif et le chiffrement. Sur GitHub, ils sont lancés avant chaque publication : si l'un échoue, le site garde sa version précédente.
