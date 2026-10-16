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
- Consultation des sources du glossaire et utilisation de 100 termes maximum issus des noms enregistrés, des documents et de l’analyse comme indices de reconnaissance vocale (sauf Apple Live)
- Enregistrement des données et résumés des réunions, et export des comptes rendus en Markdown
- Interface et voix en japonais, anglais, chinois simplifié et français
- Apparence claire, sombre ou selon le système, dans une palette moka

## Prérequis

- Mac avec puce Apple Silicon, sous macOS 26 ou ultérieur
- Clé API OpenAI (Gemini est facultatif)
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) pour la conversion des fichiers PowerPoint

## Installation

### Installer l’application

1. Téléchargez le fichier `.dmg` pour Apple Silicon depuis [Releases](https://github.com/uotian/ledad-app/releases/latest).
2. Ouvrez le DMG et faites glisser `ledad.app` dans le dossier Applications.
3. Ouvrez `ledad.app` depuis Applications.

L’application incluse est signée avec Apple Development ; le DMG lui-même n’est ni signé ni notarié, et macOS peut bloquer l’ouverture de l’application.

Si macOS bloque cette application dont vous avez vérifié la provenance, fermez l’alerte, puis ouvrez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Consultez les [instructions Apple](https://support.apple.com/fr-fr/102445).

### Enregistrer les clés API

Ajoutez votre clé API OpenAI dans Réglages → IA. Pour utiliser également Gemini, cochez l’option Gemini et ajoutez sa clé.

Une `base_url` personnalisée compatible avec OpenAI permet de traiter le texte et l’audio via ce point de connexion. Dans ce cas, la transcription Live utilise Apple et Gemini est désactivé. Le serveur doit prendre en charge les modèles et formats API existants ; voir les [conditions de connexion](docs/design/05-ai/02-connection.md).

### Autoriser l’accès audio

Au premier démarrage d’une réunion, autorisez l’accès au micro et à l’audio système. Si vous avez refusé, autorisez ledad dans Réglages Système → Confidentialité et sécurité → Microphone / Enregistrement de l’écran et de l’audio système, puis redémarrez l’application si cela vous est demandé.

## Utilisation

1. Dans l’accueil, choisissez la source audio et les langues, puis cliquez sur Démarrer une réunion.
2. Suivez la transcription et la traduction, consultez l’IA, puis préparez et faites lire vos prises de parole.
3. Utilisez Arrêter l’écoute et Reprendre pour contrôler l’écoute. Choisissez Terminer pour enregistrer et résumer la réunion.

## Remarques

- Cette application est développée en vibe coding avec Codex.
- L’utilisation des API OpenAI et Gemini est facturée. Le coût affiché est une estimation.
- Les données des réunions sont stockées sur votre Mac. L’audio, les conversations et les documents sont transmis aux API d’IA externes selon les traitements nécessaires.
- L’écoute s’arrête automatiquement après 30 minutes par défaut (durée réglable). Choisissez Reprendre pour continuer.
- Pour transmettre la voix générée dans Zoom ou une autre application, configurez séparément le partage audio.

## Documentation

[Notes de conception (japonais, en cours de rédaction)](docs/design/00-overview.md)

## Historique des versions

Consultez l’[historique des versions](CHANGELOG.md).

## Licence

[MIT](LICENSE)
