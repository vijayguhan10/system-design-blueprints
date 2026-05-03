package LLD.SOLID_Principles;

public  class SingleInstance {
    private static SingleInstance instance;

    private SingleInstance() {
        // Private constructor to prevent instantiation
    }

    public static SingleInstance getInstance() {
        if (instance == null) {
            instance = new SingleInstance();
        }
        return instance;
    }

    public void someMethod() {
        System.out.println("This is a method in the singleton class.");
    }
}
