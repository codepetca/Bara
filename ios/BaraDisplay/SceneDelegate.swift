import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var displayController: DisplayViewController?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let controller = DisplayViewController()
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        displayController = controller
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        guard let windowScene = scene as? UIWindowScene else { return }
        displayController?.activate(on: windowScene.screen)
    }

    func sceneWillResignActive(_ scene: UIScene) { displayController?.deactivate() }
    func sceneDidDisconnect(_ scene: UIScene) { displayController?.deactivate() }
}
