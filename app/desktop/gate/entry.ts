// Entry point for the desktop gate bundle. Import order matters: the settle
// hold must wrap fetch before the app's modules run.
import "./settle";
import "../index";
