python -m pip install --user modal
npm install
modal secret create downhill-assets MESHY_API_KEY="$MESHY_API_KEY" ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" --force
modal volume create downhill-assets
modal run tools/assets/modal_app.py --kind sfx
modal run tools/assets/modal_app.py --kind music
modal run tools/assets/modal_app.py --kind voice
modal run tools/assets/modal_app.py --kind models --only boulder
tools/assets/fetch.sh
