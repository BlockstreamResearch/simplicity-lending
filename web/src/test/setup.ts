import { installBrowserEnvironment, installFakeExtension } from './appkitEnvironment'

installBrowserEnvironment()

/*
 * A page that already has the extension on it, before anything imports the connection layer.
 * The layer looks for a held session the moment it is built, and with nothing on the page that
 * look spends its whole timeout before failing. Each test replaces this with its own fake.
 */
installFakeExtension()
