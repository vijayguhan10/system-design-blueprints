#include<iostream>
#include<vector>
using namespace std;
int main(){
    int n;
    cin>>n;
    vector<int> bitmap(32,0);
    for(int i=0;i<n;i++){
        int num;
        cin>>num;
        bitmap[num]++;
    }
    for(int i=0;i<bitmap.size();i++){
        if(bitmap[i]>0){
            cout<<i<<" "<<bitmap[i]<<endl;
        }
    }
}