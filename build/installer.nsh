!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var DialogDesktopShortcutCheckbox
  Var DialogContextMenuCheckbox
  Var CreateDesktopShortcutState
  Var AddContextMenuState
!endif

!macro RegisterEditWithEvd EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\EVD.Edit" "" "$(evdEditMenuText)"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\EVD.Edit" "Icon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\EVD.Edit\command" "" `"$appExe" "%1"`
!macroend

!macro UnregisterEditWithEvd EXT
  DeleteRegKey SHELL_CONTEXT "Software\Classes\SystemFileAssociations\.${EXT}\shell\EVD.Edit"
!macroend

!macro RegisterEvdProjectAssociation EXT PROGID DESCRIPTION
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}" "" "${PROGID}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${PROGID}\shell\open\command" "" `"$appExe" "%1"`
!macroend

!macro UnregisterEvdProjectAssociation EXT PROGID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${If} $0 == "${PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
  ${EndIf}
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${PROGID}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.${EXT}"
!macroend

!macro RegisterEvdControlPackageFolder
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\EVD.ControlPackage" "" "$(evdControlPackageMenuText)"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\EVD.ControlPackage" "Icon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Directory\shell\EVD.ControlPackage\command" "" `"$appExe" --open-control-package "%1"`
!macroend

!macro UnregisterEvdControlPackageFolder
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Directory\shell\EVD.ControlPackage"
!macroend

LangString installerOptionsPageTitle 1055 "Ek Seçenekler"
LangString installerOptionsPageTitle 1033 "Additional Options"
LangString installerOptionsPageTitle 1031 "Zusaetzliche Optionen"
LangString installerOptionsPageTitle 3082 "Opciones adicionales"
LangString installerOptionsPageTitle 1036 "Options supplementaires"

LangString installerOptionsPageSubtitle 1055 "Kurulumla birlikte kullanmak istediginiz kisayollari ve baglam menusu entegrasyonunu secin."
LangString installerOptionsPageSubtitle 1033 "Choose the shortcuts and context menu integration you want to install with EVD."
LangString installerOptionsPageSubtitle 1031 "Waehlen Sie die Verknuepfungen und die Kontextmenue-Integration aus, die mit EVD installiert werden sollen."
LangString installerOptionsPageSubtitle 3082 "Elija los accesos directos y la integracion del menu contextual que desea instalar con EVD."
LangString installerOptionsPageSubtitle 1036 "Choisissez les raccourcis et l integration du menu contextuel a installer avec EVD."

LangString installerDesktopShortcutLabel 1055 "Masaustu kisayolu olustur"
LangString installerDesktopShortcutLabel 1033 "Create a desktop shortcut"
LangString installerDesktopShortcutLabel 1031 "Desktop-Verknuepfung erstellen"
LangString installerDesktopShortcutLabel 3082 "Crear un acceso directo en el escritorio"
LangString installerDesktopShortcutLabel 1036 "Creer un raccourci sur le bureau"

LangString installerContextMenuLabel 1055 "Video ve proje dosyalarına EVD ile düzenle, klasörlere EVD kontrol paketiyle aç seçeneğini ekle"
LangString installerContextMenuLabel 1033 "Add Edit with EVD for video/project files and Open as an EVD review package for folders"
LangString installerContextMenuLabel 1031 "EVD-Bearbeitung für Video-/Projektdateien und EVD-Kontrollpakete für Ordner hinzufügen"
LangString installerContextMenuLabel 3082 "Agregar Editar con EVD para vídeos/proyectos y Abrir como paquete EVD para carpetas"
LangString installerContextMenuLabel 1036 "Ajouter Modifier avec EVD pour les vidéos/projets et Ouvrir comme package EVD pour les dossiers"

LangString evdEditMenuText 1055 "EVD ile düzenle"
LangString evdEditMenuText 1033 "Edit with EVD"
LangString evdEditMenuText 1031 "Mit EVD bearbeiten"
LangString evdEditMenuText 3082 "Editar con EVD"
LangString evdEditMenuText 1036 "Modifier avec EVD"

LangString evdControlPackageMenuText 1055 "EVD kontrol paketiyle aç"
LangString evdControlPackageMenuText 1033 "Open as an EVD review package"
LangString evdControlPackageMenuText 1031 "Als EVD-Kontrollpaket öffnen"
LangString evdControlPackageMenuText 3082 "Abrir como paquete de revisión EVD"
LangString evdControlPackageMenuText 1036 "Ouvrir comme package de contrôle EVD"

LangString evdKveProjectType 1055 "EVD video projesi"
LangString evdKveProjectType 1033 "EVD video project"
LangString evdKveProjectType 1031 "EVD-Videoprojekt"
LangString evdKveProjectType 3082 "Proyecto de vídeo EVD"
LangString evdKveProjectType 1036 "Projet vidéo EVD"

LangString evdEngProjectType 1055 "EVD Slide Show projesi"
LangString evdEngProjectType 1033 "EVD Slide Show project"
LangString evdEngProjectType 1031 "EVD-Slide-Show-Projekt"
LangString evdEngProjectType 3082 "Proyecto Slide Show de EVD"
LangString evdEngProjectType 1036 "Projet Slide Show EVD"

LangString evdScriptProjectType 1055 "EVD betimleme ve altyazı projesi"
LangString evdScriptProjectType 1033 "EVD description and subtitle project"
LangString evdScriptProjectType 1031 "EVD-Beschreibungs- und Untertitelprojekt"
LangString evdScriptProjectType 3082 "Proyecto de descripción y subtítulos EVD"
LangString evdScriptProjectType 1036 "Projet de description et de sous-titres EVD"

!ifndef BUILD_UNINSTALLER
  Function installerOptionsPageCreate
    nsDialogs::Create 1018
    Pop $1
    ${If} $1 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "$(installerOptionsPageSubtitle)"
    Pop $0

    ${NSD_CreateCheckbox} 0 24u 100% 12u "$(installerDesktopShortcutLabel)"
    Pop $DialogDesktopShortcutCheckbox
    ${NSD_Check} $DialogDesktopShortcutCheckbox

    ${NSD_CreateCheckbox} 0 44u 100% 24u "$(installerContextMenuLabel)"
    Pop $DialogContextMenuCheckbox
    ${NSD_Check} $DialogContextMenuCheckbox

    nsDialogs::Show
  FunctionEnd

  Function installerOptionsPageLeave
    ${NSD_GetState} $DialogDesktopShortcutCheckbox $CreateDesktopShortcutState
    ${NSD_GetState} $DialogContextMenuCheckbox $AddContextMenuState
  FunctionEnd

  !macro customPageAfterChangeDir
    Page custom installerOptionsPageCreate installerOptionsPageLeave
  !macroend

  !macro customInit
    StrCpy $CreateDesktopShortcutState ${BST_CHECKED}
    StrCpy $AddContextMenuState ${BST_CHECKED}
  !macroend

  !macro customInstall
    ${If} $CreateDesktopShortcutState == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}

    ${If} $AddContextMenuState == ${BST_CHECKED}
      !insertmacro RegisterEditWithEvd mp4
      !insertmacro RegisterEditWithEvd mkv
      !insertmacro RegisterEditWithEvd avi
      !insertmacro RegisterEditWithEvd mov
      !insertmacro RegisterEditWithEvd webm
      !insertmacro RegisterEditWithEvd wmv
      !insertmacro RegisterEditWithEvd m4v
      !insertmacro RegisterEditWithEvd mpg
      !insertmacro RegisterEditWithEvd mpeg
      !insertmacro RegisterEditWithEvd ts
      !insertmacro RegisterEditWithEvd mts
      !insertmacro RegisterEditWithEvd flv
      !insertmacro RegisterEditWithEvd 3gp
      !insertmacro RegisterEditWithEvd vob
      !insertmacro RegisterEditWithEvd kve
      !insertmacro RegisterEditWithEvd eng
      !insertmacro RegisterEditWithEvd evdscript
      !insertmacro RegisterEvdControlPackageFolder
      System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
    ${EndIf}

    !insertmacro RegisterEvdProjectAssociation kve "EVD.kve" "$(evdKveProjectType)"
    !insertmacro RegisterEvdProjectAssociation eng "EVD.eng" "$(evdEngProjectType)"
    !insertmacro RegisterEvdProjectAssociation evdscript "EVD.evdscript" "$(evdScriptProjectType)"
    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  !macroend
!endif

!macro customUnInstall
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  !insertmacro UnregisterEditWithEvd mp4
  !insertmacro UnregisterEditWithEvd mkv
  !insertmacro UnregisterEditWithEvd avi
  !insertmacro UnregisterEditWithEvd mov
  !insertmacro UnregisterEditWithEvd webm
  !insertmacro UnregisterEditWithEvd wmv
  !insertmacro UnregisterEditWithEvd m4v
  !insertmacro UnregisterEditWithEvd mpg
  !insertmacro UnregisterEditWithEvd mpeg
  !insertmacro UnregisterEditWithEvd ts
  !insertmacro UnregisterEditWithEvd mts
  !insertmacro UnregisterEditWithEvd flv
  !insertmacro UnregisterEditWithEvd 3gp
  !insertmacro UnregisterEditWithEvd vob
  !insertmacro UnregisterEditWithEvd kve
  !insertmacro UnregisterEditWithEvd eng
  !insertmacro UnregisterEditWithEvd evdscript
  !insertmacro UnregisterEvdControlPackageFolder
  !insertmacro UnregisterEvdProjectAssociation kve "EVD.kve"
  !insertmacro UnregisterEvdProjectAssociation eng "EVD.eng"
  !insertmacro UnregisterEvdProjectAssociation evdscript "EVD.evdscript"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

