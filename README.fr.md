# ledad

[日本語](README.ja.md) | [English](README.md) | [中文（简体）](README.zh.md) | [Français](README.fr.md)

Une application Mac qui transcrit et traduit les réunions en temps réel. L’IA vous aide à comprendre les échanges et à intervenir : suivez la conversation, consultez l’IA et faites lire vos propositions à voix haute.

![Démonstration de ledad](docs/assets/ledad-demo.gif)

Démonstration de l’interface avec une conversation fictive.

Technologies : Next.js 16, React 19, TypeScript, Python, Tauri 2, Swift, API OpenAI, API Gemini et Apple SpeechTranscriber.

Next.js gère l’interface et la transmission audio en temps réel, tandis que Python gère les données des réunions et les traitements d’IA. Tauri et Swift assurent l’intégration native à macOS et la capture audio.

## Fonctionnalités

- Entrée audio depuis le micro, le PC ou les deux
- Transcription et traduction Live à faible latence, puis résultats Fixed par réanalyse de l’audio enregistré
- Affichage des sujets et des mentions, questions et demandes vous concernant
- Consultation de l’IA selon le contexte de la réunion (Chat) et préparation de prises de parole (Ask)
- Lecture à voix haute des propositions vérifiées, avec pause et reprise
- Création d’un texte de référence et d’un glossaire à partir de PDF, PowerPoint, images et textes
- Enregistrement des données et résumés des réunions, et export des comptes rendus en Markdown
- Interface et voix en japonais, anglais, chinois simplifié et français

## Prérequis

- Mac avec puce Apple Silicon, sous macOS 26 ou ultérieur
- Clés API OpenAI et Gemini
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) pour la conversion des fichiers PowerPoint

## Installation

Compilez l’application depuis les sources sur votre propre Mac. Aucun téléchargement d’application précompilée et notariée n’est fourni.

### Préparer l’environnement de compilation

1. Installez [Node.js](https://nodejs.org/fr/download) 22 ou ultérieur.
2. Installez [uv](https://docs.astral.sh/uv/getting-started/installation/) et [Rust (rustup)](https://rust-lang.org/tools/install/) selon leurs instructions officielles.
3. Installez Xcode depuis le Mac App Store, ouvrez-le et terminez sa configuration initiale.

### Récupérer les sources

```sh
git clone https://github.com/uotian/ledad-app.git
cd ledad-app
```

### Installer les dépendances

À la racine du projet, exécutez :

```sh
npm ci
```

### Préparer un certificat de signature

Avant la première compilation, préparez un certificat de développement :

1. Dans Xcode, ouvrez Settings → Accounts et ajoutez votre compte Apple.
2. Sélectionnez votre Team, puis ouvrez Manage Certificates.
3. Cliquez sur « + » et créez un certificat Apple Development.

Le certificat et sa clé privée sont stockés dans le trousseau de session du Mac et réutilisés pour les compilations suivantes.

### Compiler l’application

À la racine du projet, exécutez :

```sh
npm run app:build
```

L’application `build/ledad.app` est créée. Ouvrez-la dans le Finder.

### Enregistrer les clés API

Ajoutez vos clés API OpenAI et Gemini dans les Réglages de l’application.

### Autoriser l’accès audio

Au premier démarrage d’une réunion, autorisez l’accès au micro et à l’audio système. Si vous avez refusé, autorisez ledad dans Réglages Système → Confidentialité et sécurité → Microphone / Enregistrement de l’écran et de l’audio système, puis redémarrez l’application si cela vous est demandé.

## Utilisation

1. Dans l’accueil, choisissez la source audio et les langues, puis cliquez sur Démarrer une réunion.
2. Suivez la transcription et la traduction, consultez l’IA, puis préparez et faites lire vos prises de parole.
3. Utilisez Arrêter l’écoute et Reprendre pour contrôler l’écoute. Choisissez Terminer pour enregistrer et résumer la réunion.

## Remarques

- L’utilisation des API OpenAI et Gemini est facturée. Le coût affiché est une estimation.
- Les données des réunions sont stockées sur votre Mac. L’audio, les conversations et les documents sont transmis aux API d’IA externes selon les traitements nécessaires.
- L’écoute s’arrête automatiquement après 30 minutes par défaut (durée réglable). Choisissez Reprendre pour continuer.
- Pour transmettre la voix générée dans Zoom ou une autre application, configurez séparément le partage audio.

## Documentation

[Notes de conception (japonais, en cours de rédaction)](docs/design/00-overview.md)

## Historique des versions

Consultez l’[historique des versions](CHANGELOG.md).

## Licence

[MIT](LICENSE). Les polices et icônes incluses conservent leurs licences respectives : [polices](public/licenses/Outfit-OFL.txt) et [icônes](public/icons/providers/LICENSE).

Cette application est développée en vibe coding avec Codex.
