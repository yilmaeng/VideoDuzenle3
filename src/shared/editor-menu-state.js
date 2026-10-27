'use strict';

// Shared by the renderer and native menu; no labels or shortcut changes.
function capabilities(state = {}) {
    const media = !!state.media;
    const selection = media && !!state.selection;
    const text = !!state.text;
    const writable = text && !!state.writable;
    return {
        undo: text ? !!state.textUndo : !!state.undo,
        redo: text ? !!state.textRedo : !!state.redo,
        cut: text ? writable && !!state.textSelection : selection,
        copy: text ? !!state.textSelection : selection,
        paste: text ? writable : !!state.paste,
        delete: text ? writable && !!state.textSelection : selection,
        split: media && !text,
        select_all: text ? !!state.textContent : media,
        clear_selection: selection || (media && !!state.extendedSelection),
        select_range: media,
        select_between_markers: media && !!state.markers,
        change_speed: selection,
        video_properties: media,
        audio_settings: media,
        list_silences: media
    };
}

// Every command outside the recording/broadcast menu has an explicit policy.
// A new menu action must declare its requirement here; coverage tests reject
// omissions instead of silently leaving it enabled.
const requirements = {};
function register(section, names, requirement) {
    for (const name of names.split(' ')) requirements[`menu.${section}.${name}`] = requirement;
}
register('file', 'new_slideshow open_project new_window new open elevenlabs_dubbing_import sync_external_audio sync_reference_audio quit', 'always');
register('file', 'save_project save save_as fast_export export_video_only export_audio_only', 'media');
register('file', 'save_selection', 'selectionOrQueue');
register('file', 'close', 'loaded');
register('edit', 'speech_search', 'media');
register('edit', 'extended_selection', 'media');
register('edit', 'filler_review', 'media');
register('edit', 'vocal_separation', 'always');
register('edit', 'video_crop', 'media');
register('edit', 'speech_search_export', 'media');
register('edit', 'speech_search_import', 'media');
register('play', 'toggle pause_at_position preview_cut skip_silence forward_1s backward_1s forward_30s backward_30s forward_5m backward_5m goto_start goto_end goto_middle goto_before_end goto_timecode fine_tune', 'media');
register('play', 'play_selection', 'selection');
register('insert', 'video vertical_video cta_library description_subtitle_editor subtitle_tts_project transition_library selection_queue insertion_queue', 'always');
register('insert', 'audio video_layer text ticker images subtitle apply_to_object', 'media');
register('insert', 'vertical_video_from_selection vertical_video_add_selection_to_queue', 'selection');
register('insert', 'vertical_video_add_marker_pairs_to_queue', 'markerPair');
register('insert', 'vertical_video_queue_open vertical_video_queue_clear', 'selectionQueue');
register('insert', 'apply_active_transition', 'activeTransition');
register('insert', 'apply_transition_to_markers', 'transitionMarkers');
register('insert', 'transition_list apply_all_transitions', 'transitions');
register('view', 'rotate_90_cw rotate_90_ccw rotate_180', 'media');
register('view', 'fullscreen devtools', 'always');
register('goto', 'next_marker previous_marker', 'anyMarkers');
register('goto', 'selection_start selection_end', 'selection');
register('markers', 'add', 'media');
register('markers', 'delete clear_all list', 'anyMarkers');
register('ai', 'describe_current_position intelligent_selection', 'media');
register('ai', 'describe_selection', 'selection');
register('ai', 'instant_voice_translation api_key openai_api_key elevenlabs_api_key', 'always');
register('ai', 'settings service_claude service_deepseek service_groq', 'always');
register('help', 'shortcuts keyboard_manager help_menu description_subtitle_editor_guide review_package_guide subtitle_voiceover_guide feedback startup_welcome open_log_folder', 'always');
requirements['messages.about_label'] = 'always';
for (const name of ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'split', 'select_all', 'clear_selection', 'select_range', 'select_between_markers', 'change_speed', 'video_properties', 'audio_settings', 'list_silences']) {
    requirements[`menu.edit.${name}`] = name;
}
Object.freeze(requirements);

function editorMenuState(state = {}) {
    const values = capabilities(state);
    const media = !!state.media;
    const available = {
        ...values,
        always: true,
        media,
        loaded: !!state.loaded,
        selection: media && !!state.selection,
        selectionQueue: !!state.selectionQueue,
        selectionOrQueue: (media && !!state.selection) || !!state.selectionQueue,
        anyMarkers: media && !!state.anyMarkers,
        markerPair: media && !!state.markers,
        activeTransition: media && !!state.activeTransition,
        transitionMarkers: media && !!state.activeTransition && !!state.anyMarkers,
        transitions: media && !!state.transitions
    };
    const result = {};
    for (const [key, requirement] of Object.entries(requirements)) result[key] = !!available[requirement];
    return result;
}

editorMenuState.requirements = requirements;
module.exports = editorMenuState;
